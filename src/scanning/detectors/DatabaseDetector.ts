import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import {
  CONNECTION_STRING_DB_REGEX,
  DB_CONTEXT_REGEX,
  ADD_DB_CONTEXT_REGEX,
  STORED_PROC_REGEX,
  SQL_PROJECT_REGEX,
} from "../../utils/Constants";
import { IDetector } from "./IDetector";

export class DatabaseDetector implements IDetector {
  private databaseOwners: Map<string, Set<string>> = new Map();
  // repoName -> (configKeyLower -> Set<dbName>)
  private repoConfigKeyToDatabases: Map<string, Map<string, Set<string>>> = new Map();

  reset(): void {
    this.databaseOwners.clear();
    this.repoConfigKeyToDatabases.clear();
  }

  /** @deprecated Use reset() instead */
  resetDatabaseOwners(): void {
    this.reset();
  }

  getDatabaseOwners(): Map<string, Set<string>> {
    return this.databaseOwners;
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    _allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];
    const databases = new Set<string>();

    // Extract database names from common env/YAML-style config
    // Example patterns seen in service docs: *_DB_NAME: foo, DB_NAME=foo
    if (
      /\.(?:ya?ml|env(?:\.[^/\\]+)?)$/i.test(filePath) ||
      /docker-compose\.ya?ml$/i.test(filePath)
    ) {
      const envDbRegex =
        /^\s*[A-Z0-9_\-]*?(?:DB_NAME|DATABASE_NAME|MYSQL_DATABASE|POSTGRES_DB|MSSQL_DATABASE)\s*[:=]\s*['"]?([A-Za-z0-9_\-]+)['"]?\s*$/gim;
      let envMatch: RegExpExecArray | null;
      while ((envMatch = envDbRegex.exec(content)) !== null) {
        databases.add(envMatch[1].trim());
      }
    }

    // Extract database names from connection strings in appsettings
    if (/appsettings.*\.json$/i.test(filePath)) {
      try {
        const config = JSON.parse(content);

        // 1) Standard ConnectionStrings section
        const connStrings = config.ConnectionStrings;
        if (connStrings && typeof connStrings === "object") {
          for (const [, value] of Object.entries(connStrings)) {
            if (typeof value !== "string") continue;
            this.extractDbNamesFromConnectionString(value, databases);
          }
        }

        // 2) Any nested JSON key named/ending with "ConnectionString" (common pattern)
        // Store mapping so C# GetSection("A:B:ConnectionString") can be resolved.
        const extracted = this.extractConnectionStringLikeSettings(config);
        for (const item of extracted) {
          const keyLower = item.keyPath.toLowerCase();
          const dbNames = this.extractDbNamesFromConnectionString(item.value);
          if (dbNames.length === 0) continue;

          for (const db of dbNames) databases.add(db);

          if (!this.repoConfigKeyToDatabases.has(repoName)) {
            this.repoConfigKeyToDatabases.set(repoName, new Map());
          }
          const keyMap = this.repoConfigKeyToDatabases.get(repoName)!;
          if (!keyMap.has(keyLower)) keyMap.set(keyLower, new Set());
          for (const db of dbNames) keyMap.get(keyLower)!.add(db);
        }
      } catch {
        // Not valid JSON
      }
    }

    // Extract from .cs files
    if (filePath.endsWith(".cs")) {
      let match: RegExpExecArray | null;

      // Pre-collect AddDbContext connection string names (single pass)
      const addCtxNames: string[] = [];
      const addCtxRegex = new RegExp(ADD_DB_CONTEXT_REGEX.source, "g");
      let addMatch: RegExpExecArray | null;
      while ((addMatch = addCtxRegex.exec(content)) !== null) {
        addCtxNames.push(addMatch[2].trim());
      }

      // DbContext detection — if any DbContext class is found, use pre-collected names
      const ctxRegex = new RegExp(DB_CONTEXT_REGEX.source, "g");
      if (ctxRegex.test(content) && addCtxNames.length > 0) {
        for (const name of addCtxNames) {
          databases.add(name);
        }
      }

      // Standalone GetConnectionString("name") calls — covers data access layers
      // that pull connection strings from IConfiguration/ACS at runtime
      const getConnStrRegex = /GetConnectionString\s*\(\s*["']([^"']+)["']\s*\)/g;
      while ((match = getConnStrRegex.exec(content)) !== null) {
        databases.add(match[1].trim());
      }

      // Configuration section references (example):
      // _configuration.GetSection("DoshEnfuceDatabaseService:ConnectionString").Value
      // configuration["DoshEnfuceDatabaseService:ConnectionString"]
      const sectionRegex = /GetSection\s*\(\s*["']([^"']*ConnectionString[^"']*)["']\s*\)/gi;
      while ((match = sectionRegex.exec(content)) !== null) {
        const key = match[1].trim();
        this.addDatabasesFromConfigKey(repoName, key, databases);
      }

      const indexerRegex = /\[\s*["']([^"']*ConnectionString[^"']*)["']\s*\]/gi;
      while ((match = indexerRegex.exec(content)) !== null) {
        const key = match[1].trim();
        this.addDatabasesFromConfigKey(repoName, key, databases);
      }

      // SqlConnection with inline connection string: new SqlConnection("...Database=X...")
      const sqlConnRegex = /new\s+SqlConnection\s*\(\s*[@$]?"([^"]+)"/g;
      let sqlMatch: RegExpExecArray | null;
      while ((sqlMatch = sqlConnRegex.exec(content)) !== null) {
        const connStr = sqlMatch[1];
        this.extractDbNamesFromConnectionString(connStr, databases);
      }

      // Connection string literals in code
      const connRegex = new RegExp(CONNECTION_STRING_DB_REGEX.source, "gi");
      while ((match = connRegex.exec(content)) !== null) {
        databases.add(match[1].trim());
      }

      // Stored procedure calls
      const spRegex = new RegExp(STORED_PROC_REGEX.source, "gi");
      while ((match = spRegex.exec(content)) !== null) {
        const spName = match[1];
        // Track stored procs as shared DB artifacts
        databases.add(`sp:${spName}`);
      }
    }

    // .sqlproj files indicate database ownership
    if (SQL_PROJECT_REGEX.test(filePath)) {
      const projNameMatch = filePath.match(/([^/]+)\.sqlproj$/i);
      if (projNameMatch) {
        databases.add(projNameMatch[1]);
      }
    }

    // Register this repo's databases
    for (const db of databases) {
      if (!this.databaseOwners.has(db)) {
        this.databaseOwners.set(db, new Set());
      }
      this.databaseOwners.get(db)!.add(repoName);
    }

    // Create bidirectional edges for shared databases
    // Both directions are created so earlier-scanned repos also get edges
    const seen = new Set<string>();
    for (const db of databases) {
      const owners = this.databaseOwners.get(db);
      if (!owners) continue;
      for (const otherRepo of owners) {
        if (otherRepo === repoName) continue;
        const forwardKey = `${repoName}:${otherRepo}:${db}`;
        const reverseKey = `${otherRepo}:${repoName}:${db}`;
        const detail = db.startsWith("sp:")
          ? `Shared stored procedure "${db.slice(3)}" with ${otherRepo}`
          : `Shared database "${db}" with ${otherRepo}`;
        const confidence = db.startsWith("sp:") ? Confidence.Medium : Confidence.High;
        // Edge from current repo to other repo
        if (!seen.has(forwardKey)) {
          seen.add(forwardKey);
          deps.push({
            sourceRepo: repoName,
            targetRepo: otherRepo,
            type: DependencyType.Database,
            confidence,
            detail,
            sourceFile: filePath,
          });
        }
        // Reverse edge so earlier-scanned repo also links back
        if (!seen.has(reverseKey)) {
          seen.add(reverseKey);
          const reverseDetail = db.startsWith("sp:")
            ? `Shared stored procedure "${db.slice(3)}" with ${repoName}`
            : `Shared database "${db}" with ${repoName}`;
          deps.push({
            sourceRepo: otherRepo,
            targetRepo: repoName,
            type: DependencyType.Database,
            confidence,
            detail: reverseDetail,
            sourceFile: "",
          });
        }
      }
    }

    return deps;
  }

  private addDatabasesFromConfigKey(
    repoName: string,
    configKey: string,
    databases: Set<string>
  ): void {
    const keyMap = this.repoConfigKeyToDatabases.get(repoName);
    if (!keyMap) return;
    const dbs = keyMap.get(configKey.toLowerCase());
    if (!dbs) return;
    for (const db of dbs) databases.add(db);
  }

  private extractDbNamesFromConnectionString(connStr: string, addTo?: Set<string>): string[] {
    const dbs: string[] = [];
    const dbRegex = new RegExp(CONNECTION_STRING_DB_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = dbRegex.exec(connStr)) !== null) {
      const db = match[1].trim();
      if (db) dbs.push(db);
      if (addTo && db) addTo.add(db);
    }
    return dbs;
  }

  private extractConnectionStringLikeSettings(
    config: unknown
  ): Array<{ keyPath: string; value: string }> {
    const results: Array<{ keyPath: string; value: string }> = [];

    const visit = (node: unknown, path: string[]): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, path);
        return;
      }

      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const nextPath = [...path, k];
        if (typeof v === "string") {
          // Match keys that are exactly "ConnectionString" or end with it, or contain it with ADO-style colon.
          if (/connectionstring$/i.test(k) || /:connectionstring$/i.test(k)) {
            results.push({ keyPath: nextPath.join(":"), value: v });
          }
        } else {
          visit(v, nextPath);
        }
      }
    };

    visit(config, []);
    return results;
  }
}
