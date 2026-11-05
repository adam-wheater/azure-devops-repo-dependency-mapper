import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { IDetector } from "./IDetector";

/**
 * Detects Azure App Configuration (ACS) dependencies by scanning pipeline YAML
 * files for `az appconfig kv set` and `az appconfig kv set-keyvault` commands.
 *
 * Repos that write to the same ACS store are linked as shared-config dependencies.
 */
export class AppConfigDetector implements IDetector {
  // storeName -> Set<repoName>
  private storeUsers = new Map<string, Set<string>>();

  reset(): void {
    this.storeUsers.clear();
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    _allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (!this.isPipelineYaml(filePath)) return deps;

    // Match az appconfig kv set / set-keyvault commands
    const cmdRegex = /az\s+appconfig\s+kv\s+(?:set|set-keyvault)\b[^\n]*/gi;
    let cmdMatch: RegExpExecArray | null;
    while ((cmdMatch = cmdRegex.exec(content)) !== null) {
      const line = cmdMatch[0];
      const storeName = this.extractFlag(line, "--name", "-n");
      if (!storeName) continue;

      // Register this repo as a user of this ACS store
      if (!this.storeUsers.has(storeName)) {
        this.storeUsers.set(storeName, new Set());
      }
      this.storeUsers.get(storeName)!.add(repoName);
    }

    // Create edges between repos sharing the same ACS store
    this.createSharedStoreEdges(repoName, filePath, deps);

    return deps;
  }

  private createSharedStoreEdges(
    repoName: string,
    filePath: string,
    deps: DetectedDependency[]
  ): void {
    const seen = new Set<string>();
    for (const [storeName, repos] of this.storeUsers) {
      if (!repos.has(repoName)) continue;
      for (const otherRepo of repos) {
        if (otherRepo === repoName) continue;
        const forwardKey = `${repoName}:${otherRepo}:${storeName}`;
        const reverseKey = `${otherRepo}:${repoName}:${storeName}`;

        if (!seen.has(forwardKey)) {
          seen.add(forwardKey);
          deps.push({
            sourceRepo: repoName,
            targetRepo: otherRepo,
            type: DependencyType.AppConfig,
            confidence: Confidence.High,
            detail: `Shared Azure App Configuration store "${storeName}" with ${otherRepo}`,
            sourceFile: filePath,
          });
        }
        if (!seen.has(reverseKey)) {
          seen.add(reverseKey);
          deps.push({
            sourceRepo: otherRepo,
            targetRepo: repoName,
            type: DependencyType.AppConfig,
            confidence: Confidence.High,
            detail: `Shared Azure App Configuration store "${storeName}" with ${repoName}`,
            sourceFile: "",
          });
        }
      }
    }
  }

  private isPipelineYaml(path: string): boolean {
    return (
      /(?:azure-pipelines|\.azure[/\\]pipelines|pipelines?[/\\][^/\\]*)\.ya?ml$/i.test(path) ||
      /deploy[^/\\]*\.ya?ml$/i.test(path) ||
      /templates[/\\][^/\\]*\.ya?ml$/i.test(path)
    );
  }

  private extractFlag(line: string, longFlag: string, shortFlag: string): string | null {
    // Match --name <value> or --name=<value> or -n <value>
    const longRegex = new RegExp(
      `${longFlag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[=\\s]+['"]?([^\\s'"]+)['"]?`
    );
    const shortRegex = new RegExp(
      `\\s${shortFlag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+['"]?([^\\s'"]+)['"]?`
    );
    const longMatch = longRegex.exec(line);
    if (longMatch) return longMatch[1];
    const shortMatch = shortRegex.exec(line);
    if (shortMatch) return shortMatch[1];
    return null;
  }
}
