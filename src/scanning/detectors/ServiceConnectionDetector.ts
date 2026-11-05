import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { IDetector } from "./IDetector";

/**
 * Detects Azure DevOps Service Connection usage by scanning pipeline YAML
 * for common task input keys that reference a service connection.
 *
 * Repos that reference the same service connection are linked as shared-infra dependencies.
 */
export class ServiceConnectionDetector implements IDetector {
  // connectionName -> Set<repoName>
  private connectionUsers = new Map<string, Set<string>>();

  reset(): void {
    this.connectionUsers.clear();
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    _allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];
    if (!this.isPipelineYaml(filePath)) return deps;

    const connections = this.extractConnectionsFromYaml(content);
    for (const conn of connections) {
      if (!this.connectionUsers.has(conn)) {
        this.connectionUsers.set(conn, new Set());
      }
      this.connectionUsers.get(conn)!.add(repoName);
    }

    this.createSharedConnectionEdges(repoName, filePath, deps);
    return deps;
  }

  private createSharedConnectionEdges(
    repoName: string,
    filePath: string,
    deps: DetectedDependency[]
  ): void {
    const seen = new Set<string>();
    for (const [connName, repos] of this.connectionUsers) {
      if (!repos.has(repoName)) continue;
      for (const otherRepo of repos) {
        if (otherRepo === repoName) continue;

        const forwardKey = `${repoName}:${otherRepo}:${connName}`;
        const reverseKey = `${otherRepo}:${repoName}:${connName}`;

        const confidence = this.isVariableReference(connName) ? Confidence.Medium : Confidence.High;

        if (!seen.has(forwardKey)) {
          seen.add(forwardKey);
          deps.push({
            sourceRepo: repoName,
            targetRepo: otherRepo,
            type: DependencyType.ServiceConnection,
            confidence,
            detail: `Shared Azure DevOps service connection "${connName}" with ${otherRepo}`,
            sourceFile: filePath,
          });
        }
        if (!seen.has(reverseKey)) {
          seen.add(reverseKey);
          deps.push({
            sourceRepo: otherRepo,
            targetRepo: repoName,
            type: DependencyType.ServiceConnection,
            confidence,
            detail: `Shared Azure DevOps service connection "${connName}" with ${repoName}`,
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

  private extractConnectionsFromYaml(content: string): Set<string> {
    const results = new Set<string>();
    const lines = content.split(/\r?\n/);

    // Common ADO task input keys that reference service connections.
    // Keep this list tight to avoid matching arbitrary endpoints.
    const keyRegex =
      /^\s*(azureSubscription|connectedServiceNameARM|azureResourceManagerConnection|azureSubscriptionEndpoint|kubernetesServiceEndpoint|containerRegistry|dockerRegistryServiceConnection)\s*:\s*(.+?)\s*$/i;

    for (const rawLine of lines) {
      // Strip YAML comments (best-effort)
      const line = rawLine.replace(/\s+#.*$/, "");
      const match = keyRegex.exec(line);
      if (!match) continue;

      const value = this.normalizeYamlScalar(match[2]);
      if (!value) continue;
      results.add(value);
    }

    return results;
  }

  private normalizeYamlScalar(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Remove surrounding quotes
    const unquoted = trimmed.replace(/^['"]|['"]$/g, "").trim();
    if (!unquoted) return null;

    // Ignore obvious non-values
    if (/^(null|~)$/i.test(unquoted)) return null;

    return unquoted;
  }

  private isVariableReference(value: string): boolean {
    return /\$\(|\$\{\{/.test(value);
  }
}
