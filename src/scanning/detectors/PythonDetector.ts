import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { fuzzyMatchRepo } from "../../utils/Constants";
import { IDetector } from "./IDetector";

function normalizePep503(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export class PythonDetector implements IDetector {
  private publishedPackages: Map<string, string> = new Map();
  private seenEdges = new Set<string>();

  reset(): void {
    this.publishedPackages.clear();
    this.seenEdges.clear();
  }

  /** @deprecated Use reset() instead */
  resetPublishedPackages(): void {
    this.reset();
  }

  registerPublished(repoName: string, filePath: string, content: string): void {
    if (/pyproject\.toml$/i.test(filePath)) {
      this.registerPyprojectPackage(repoName, content);
    } else if (/setup\.py$/i.test(filePath)) {
      this.registerSetupPyPackage(repoName, content);
    }
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (/requirements\.txt$/i.test(filePath)) {
      this.scanRequirementsTxt(repoName, filePath, content, allRepoNames, deps);
    } else if (/pyproject\.toml$/i.test(filePath)) {
      this.registerPyprojectPackage(repoName, content);
      this.scanPyprojectToml(repoName, filePath, content, allRepoNames, deps);
    } else if (/setup\.py$/i.test(filePath)) {
      this.registerSetupPyPackage(repoName, content);
      this.scanSetupPy(repoName, filePath, content, allRepoNames, deps);
    } else if (/Pipfile$/i.test(filePath)) {
      this.scanPipfile(repoName, filePath, content, allRepoNames, deps);
    }

    return deps;
  }

  /**
   * Register the package name published from pyproject.toml.
   * Looks for [project] name = "..." or name = "..." under [tool.poetry].
   */
  private registerPyprojectPackage(repoName: string, content: string): void {
    // Match name under [project] or [tool.poetry] sections
    const nameRegex =
      /\[(?:project|tool\.poetry)\]\s*\n(?:(?!\n\[)[\s\S])*?name\s*=\s*["']([^"']+)["']/i;
    const match = nameRegex.exec(content);
    if (match) {
      this.publishedPackages.set(normalizePep503(match[1].trim()), repoName);
    }
  }

  /**
   * Register the package name published from setup.py.
   * Looks for name='...' or name="..." in the setup() call.
   */
  private registerSetupPyPackage(repoName: string, content: string): void {
    const nameRegex = /setup\s*\([\s\S]*?name\s*=\s*["']([^"']+)["']/i;
    const match = nameRegex.exec(content);
    if (match) {
      this.publishedPackages.set(normalizePep503(match[1].trim()), repoName);
    }
  }

  /**
   * Scan requirements.txt for package dependencies.
   * Format: package-name==1.2.3, package-name>=1.0, package-name
   */
  private scanRequirementsTxt(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const lines = content.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Skip empty lines, comments, and option flags
      if (!line || line.startsWith("#") || line.startsWith("-")) continue;

      // Parse: package-name[extras]>=version or package-name==version or just package-name
      const reqRegex =
        /^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\[.*?\])?\s*(?:(==|>=|<=|!=|~=|>|<)\s*([^\s;#]+))?/;
      const match = reqRegex.exec(line);
      if (!match) continue;

      const packageName = match[1];
      const version = match[3] || undefined;

      this.resolvePackageDependency(
        repoName,
        filePath,
        packageName,
        version,
        allRepoNames,
        deps,
        "requirements.txt"
      );
    }
  }

  /**
   * Scan pyproject.toml for dependency declarations.
   */
  private scanPyprojectToml(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Match dependencies = [...] style (PEP 621 / tool.poetry.dependencies)
    const depsArrayRegex = /dependencies\s*=\s*\[([\s\S]*?)\]/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = depsArrayRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      // Match quoted strings inside the array
      const entryRegex = /["']([^"']+)["']/g;
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRegex.exec(block)) !== null) {
        const entry = entryMatch[1].trim();
        const parsed = this.parsePythonDependencySpec(entry);
        if (parsed) {
          this.resolvePackageDependency(
            repoName,
            filePath,
            parsed.name,
            parsed.version,
            allRepoNames,
            deps,
            "pyproject.toml"
          );
        }
      }
    }

    // Match [project.dependencies] or [tool.poetry.dependencies] section entries
    // Format: package-name = ">=1.0" or package-name = {version = "^1.0", ...}
    const sectionRegex =
      /\[(?:project\.dependencies|tool\.poetry\.dependencies)\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/g;
    while ((blockMatch = sectionRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      const lineRegex = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)\s*=\s*(.+)$/gm;
      let lineMatch: RegExpExecArray | null;
      while ((lineMatch = lineRegex.exec(block)) !== null) {
        const packageName = lineMatch[1].trim();
        // Skip python itself
        if (packageName.toLowerCase() === "python") continue;

        const valueStr = lineMatch[2].trim();
        const version = this.extractVersionFromTomlValue(valueStr);

        this.resolvePackageDependency(
          repoName,
          filePath,
          packageName,
          version,
          allRepoNames,
          deps,
          "pyproject.toml"
        );
      }
    }
  }

  /**
   * Scan setup.py for install_requires dependencies.
   */
  private scanSetupPy(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Match install_requires=['pkg1', 'pkg2>=1.0'] or install_requires=["pkg1", "pkg2"]
    const installReqRegex = /install_requires\s*=\s*\[([\s\S]*?)\]/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = installReqRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      const entryRegex = /["']([^"']+)["']/g;
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRegex.exec(block)) !== null) {
        const entry = entryMatch[1].trim();
        const parsed = this.parsePythonDependencySpec(entry);
        if (parsed) {
          this.resolvePackageDependency(
            repoName,
            filePath,
            parsed.name,
            parsed.version,
            allRepoNames,
            deps,
            "setup.py install_requires"
          );
        }
      }
    }

    // Match setup_requires and tests_require similarly
    const otherReqRegex = /(?:setup_requires|tests_require)\s*=\s*\[([\s\S]*?)\]/g;
    while ((blockMatch = otherReqRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      const entryRegex = /["']([^"']+)["']/g;
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRegex.exec(block)) !== null) {
        const entry = entryMatch[1].trim();
        const parsed = this.parsePythonDependencySpec(entry);
        if (parsed) {
          this.resolvePackageDependency(
            repoName,
            filePath,
            parsed.name,
            parsed.version,
            allRepoNames,
            deps,
            "setup.py"
          );
        }
      }
    }
  }

  /**
   * Scan Pipfile for [packages] section dependencies.
   */
  private scanPipfile(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Match [packages] section
    const packagesSectionRegex = /\[packages\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/g;
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = packagesSectionRegex.exec(content)) !== null) {
      const block = sectionMatch[1];
      this.parsePipfileSection(repoName, filePath, block, allRepoNames, deps, "Pipfile [packages]");
    }

    // Match [dev-packages] section
    const devSectionRegex = /\[dev-packages\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/g;
    while ((sectionMatch = devSectionRegex.exec(content)) !== null) {
      const block = sectionMatch[1];
      this.parsePipfileSection(
        repoName,
        filePath,
        block,
        allRepoNames,
        deps,
        "Pipfile [dev-packages]"
      );
    }
  }

  /**
   * Parse a Pipfile section block for package entries.
   * Format: package = "*" or package = "==1.0" or package = {version = ">=1.0", ...}
   */
  private parsePipfileSection(
    repoName: string,
    filePath: string,
    block: string,
    allRepoNames: string[],
    deps: DetectedDependency[],
    source: string
  ): void {
    const lineRegex = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)\s*=\s*(.+)$/gm;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const packageName = lineMatch[1].trim();
      const valueStr = lineMatch[2].trim();

      let version: string | undefined;
      // Simple string value: "*" or "==1.0" or ">=1.0"
      const simpleMatch = /^["']([^"']*)["']$/.exec(valueStr);
      if (simpleMatch) {
        const val = simpleMatch[1];
        if (val !== "*") {
          // Extract version number from specifier like "==1.0"
          const verMatch = /(?:==|>=|<=|!=|~=|>|<)\s*(.+)/.exec(val);
          version = verMatch ? verMatch[1] : undefined;
        }
      } else {
        // Dict value: {version = ">=1.0", ...}
        const dictVerMatch = /version\s*=\s*["']([^"']+)["']/.exec(valueStr);
        if (dictVerMatch) {
          const verSpec = dictVerMatch[1];
          const verMatch = /(?:==|>=|<=|!=|~=|>|<)\s*(.+)/.exec(verSpec);
          version = verMatch ? verMatch[1] : undefined;
        }
      }

      this.resolvePackageDependency(
        repoName,
        filePath,
        packageName,
        version,
        allRepoNames,
        deps,
        source
      );
    }
  }

  /**
   * Core resolution: given a package name, check if it's published by another repo
   * or heuristically matches a repo name.
   */
  private resolvePackageDependency(
    repoName: string,
    filePath: string,
    packageName: string,
    version: string | undefined,
    allRepoNames: string[],
    deps: DetectedDependency[],
    source: string
  ): void {
    const packageNormalized = normalizePep503(packageName);

    // Exact match against published packages registry
    const publisherRepo = this.publishedPackages.get(packageNormalized);
    if (publisherRepo && publisherRepo !== repoName) {
      const edgeKey = `${publisherRepo}|${packageNormalized}`;
      if (this.seenEdges.has(edgeKey)) return;
      this.seenEdges.add(edgeKey);
      const dep: DetectedDependency = {
        sourceRepo: repoName,
        targetRepo: publisherRepo,
        type: DependencyType.Python,
        confidence: Confidence.High,
        detail: `${source} "${packageName}" published by ${publisherRepo}`,
        sourceFile: filePath,
      };
      if (version) {
        dep.version = version;
      }
      deps.push(dep);
      return;
    }

    // Heuristic: package name matches a repo name
    const matchingRepo = fuzzyMatchRepo(packageName, allRepoNames, repoName);
    if (matchingRepo) {
      const edgeKey = `${matchingRepo}|${packageNormalized}`;
      if (this.seenEdges.has(edgeKey)) return;
      this.seenEdges.add(edgeKey);
      const dep: DetectedDependency = {
        sourceRepo: repoName,
        targetRepo: matchingRepo,
        type: DependencyType.Python,
        confidence: Confidence.Medium,
        detail: `${source} "${packageName}" matches repo "${matchingRepo}"`,
        sourceFile: filePath,
      };
      if (version) {
        dep.version = version;
      }
      deps.push(dep);
    }
  }

  /**
   * Parse a Python dependency specifier like "package-name>=1.0" into name and version.
   */
  private parsePythonDependencySpec(
    spec: string
  ): { name: string; version: string | undefined } | null {
    const match =
      /^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\[.*?\])?\s*(?:(?:==|>=|<=|!=|~=|>|<)\s*(.+))?$/.exec(
        spec.trim()
      );
    if (!match) return null;
    return {
      name: match[1],
      version: match[2] || undefined,
    };
  }

  /**
   * Extract version from a TOML value string.
   * Handles: ">=1.0", "^1.0", {version = "^1.0", ...}
   */
  private extractVersionFromTomlValue(value: string): string | undefined {
    // Simple quoted value: ">=1.0" or "^1.0" or "*"
    const simpleMatch = /^["']([^"']*)["']$/.exec(value);
    if (simpleMatch) {
      const val = simpleMatch[1];
      if (val === "*") return undefined;
      // Strip operator prefix to get version
      const verMatch = /(?:\^|~|==|>=|<=|!=|~=|>|<)?\s*(.+)/.exec(val);
      return verMatch ? verMatch[1].trim() : undefined;
    }

    // Dict value: {version = "^1.0", ...}
    const dictMatch = /version\s*=\s*["']([^"']+)["']/.exec(value);
    if (dictMatch) {
      const val = dictMatch[1];
      const verMatch = /(?:\^|~|==|>=|<=|!=|~=|>|<)?\s*(.+)/.exec(val);
      return verMatch ? verMatch[1].trim() : undefined;
    }

    return undefined;
  }
}
