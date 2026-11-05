import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { GO_MODULE_REGEX, GO_REQUIRE_REGEX, fuzzyMatchRepo } from "../../utils/Constants";
import { IDetector } from "./IDetector";

export class GoModuleDetector implements IDetector {
  private moduleToRepo: Map<string, string> = new Map();

  reset(): void {
    this.moduleToRepo.clear();
  }

  /** @deprecated Use reset() instead */
  resetModuleMap(): void {
    this.reset();
  }

  registerPublished(repoName: string, _filePath: string, content: string): void {
    this.registerModule(repoName, content);
  }

  registerModule(repoName: string, content: string): void {
    const match = GO_MODULE_REGEX.exec(content);
    if (match) {
      this.moduleToRepo.set(match[1].trim(), repoName);
    }
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (!filePath.endsWith("go.mod")) return deps;

    // Register this module
    this.registerModule(repoName, content);

    // Auto-detect org prefix from the module declaration
    const moduleMatch = GO_MODULE_REGEX.exec(content);
    if (!moduleMatch) return deps;
    const modulePath = moduleMatch[1].trim();
    // Org prefix: the host and org, plus the project on deeper paths
    // (github.com/org/repo -> github.com/org/, dev.azure.com/org/project/_git/repo ->
    // dev.azure.com/org/project/). A /vN major-version suffix is not a segment.
    const parts = modulePath.split("/");
    if (parts.length > 1 && /^v\d+$/.test(parts[parts.length - 1])) parts.pop();
    const orgPrefix = parts.slice(0, Math.max(1, Math.min(3, parts.length - 1))).join("/") + "/";

    // Collect all required modules from both block and single-line syntax
    const requiredModules: string[] = [];

    // Block require: require ( ... )
    const requireBlockRegex = /require\s*\(([\s\S]*?)\)/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = requireBlockRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      const reqRegex = new RegExp(GO_REQUIRE_REGEX.source, "gm");
      let reqMatch: RegExpExecArray | null;
      while ((reqMatch = reqRegex.exec(block)) !== null) {
        requiredModules.push(reqMatch[1].trim());
      }
    }

    // Single-line require: require module/path v1.2.3
    const singleReqRegex = /^require\s+(\S+)\s+v/gm;
    let singleMatch: RegExpExecArray | null;
    while ((singleMatch = singleReqRegex.exec(content)) !== null) {
      requiredModules.push(singleMatch[1].trim());
    }

    for (const reqModule of requiredModules) {
      // Check if it's an internal module (same org prefix)
      if (reqModule.startsWith(orgPrefix) && reqModule !== modulePath) {
        const targetRepo = this.moduleToRepo.get(reqModule);
        if (targetRepo && targetRepo !== repoName) {
          deps.push({
            sourceRepo: repoName,
            targetRepo,
            type: DependencyType.GoModule,
            confidence: Confidence.High,
            detail: `Go module requires internal package "${reqModule}" from ${targetRepo}`,
            sourceFile: filePath,
          });
        } else {
          // Try heuristic match with repo names
          const lastSegment = reqModule.split("/").pop() || "";
          const matched = fuzzyMatchRepo(lastSegment, allRepoNames, repoName);
          if (matched) {
            deps.push({
              sourceRepo: repoName,
              targetRepo: matched,
              type: DependencyType.GoModule,
              confidence: Confidence.Medium,
              detail: `Go module requires "${reqModule}" matching repo "${matched}"`,
              sourceFile: filePath,
            });
          }
        }
      }
    }

    return deps;
  }
}
