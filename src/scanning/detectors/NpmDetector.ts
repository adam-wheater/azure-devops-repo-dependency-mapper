import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { fuzzyMatchRepo } from "../../utils/Constants";
import { IDetector } from "./IDetector";

export class NpmDetector implements IDetector {
  private publishedPackages: Map<string, string> = new Map();

  reset(): void {
    this.publishedPackages.clear();
  }

  /** @deprecated Use reset() instead */
  resetPublishedPackages(): void {
    this.reset();
  }

  registerPublished(repoName: string, _filePath: string, content: string): void {
    let pkg: { name?: string };
    try {
      pkg = JSON.parse(content);
    } catch {
      return;
    }
    if (pkg.name) {
      this.publishedPackages.set(pkg.name.toLowerCase(), repoName);
    }
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    if (!filePath.endsWith("package.json")) return [];
    if (filePath.includes("node_modules/")) return [];

    let pkg: {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(content);
    } catch {
      return [];
    }

    // Register this package as published by this repo
    if (pkg.name) {
      this.publishedPackages.set(pkg.name.toLowerCase(), repoName);
    }

    const deps: DetectedDependency[] = [];
    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.peerDependencies || {}),
    };

    for (const [depName] of Object.entries(allDeps)) {
      const depLower = depName.toLowerCase();

      // Check if published by another repo (exact match)
      const publisherRepo = this.publishedPackages.get(depLower);
      if (publisherRepo && publisherRepo !== repoName) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: publisherRepo,
          type: DependencyType.Npm,
          confidence: Confidence.High,
          detail: `npm dependency "${depName}" published by ${publisherRepo}`,
          sourceFile: filePath,
        });
        continue;
      }

      // Heuristic: match package name to repo names
      // Handles @org/package-name style scoped packages
      const matchingRepo = fuzzyMatchRepo(depName, allRepoNames, repoName);
      if (matchingRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Npm,
          confidence: Confidence.Medium,
          detail: `npm dependency "${depName}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    return deps;
  }
}
