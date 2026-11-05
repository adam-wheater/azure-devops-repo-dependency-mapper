import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { fuzzyMatchRepo } from "../../utils/Constants";
import { isExternalImage, extractImageName } from "./imageUtils";
import { IDetector } from "./IDetector";

export class HelmDetector implements IDetector {
  reset(): void {
    // No persistent state currently, but provided for consistency with other detectors
  }

  /** @deprecated Use reset() instead */
  resetState(): void {
    this.reset();
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (/Chart\.ya?ml$/i.test(filePath)) {
      this.scanChartYaml(repoName, filePath, content, allRepoNames, deps);
    } else if (/values\.ya?ml$/i.test(filePath)) {
      this.scanValuesYaml(repoName, filePath, content, allRepoNames, deps);
    }

    return deps;
  }

  /**
   * Scan Chart.yaml for the dependencies block.
   * Format:
   *   dependencies:
   *     - name: my-chart
   *       version: 1.2.3
   *       repository: https://charts.example.com
   */
  private scanChartYaml(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Extract the dependencies block (YAML list under "dependencies:")
    const depsBlockRegex = /^dependencies:\s*\n((?:[\t ]+.*\n?)*)/gm;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = depsBlockRegex.exec(content)) !== null) {
      const block = blockMatch[1];

      // Parse individual dependency entries in the YAML list
      const entryRegex = /- *name:\s*["']?([^\s"']+)["']?/g;
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRegex.exec(block)) !== null) {
        const chartName = entryMatch[1];
        const entryStart = entryMatch.index;

        // Find the version for this entry (within the next few lines before the next "- name:")
        const restOfBlock = block.substring(entryStart);
        const nextEntryIdx = restOfBlock.indexOf("\n- ", 1);
        const entryText = nextEntryIdx >= 0 ? restOfBlock.substring(0, nextEntryIdx) : restOfBlock;

        const versionMatch = /version:\s*["']?([^\s"']+)["']?/.exec(entryText);
        const version = versionMatch ? versionMatch[1] : undefined;

        const repositoryMatch = /repository:\s*["']?([^\s"']+)["']?/.exec(entryText);
        const repository = repositoryMatch ? repositoryMatch[1] : undefined;

        this.resolveChartDependency(
          repoName,
          filePath,
          chartName,
          version,
          repository,
          allRepoNames,
          deps
        );
      }
    }
  }

  /**
   * Scan values.yaml for image references and service URL patterns.
   */
  private scanValuesYaml(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    this.scanImageReferences(repoName, filePath, content, allRepoNames, deps);
    this.scanServiceReferences(repoName, filePath, content, allRepoNames, deps);
  }

  /**
   * Detect image: references in values.yaml.
   * Patterns:
   *   image: myregistry/myapp:tag
   *   image:
   *     repository: myregistry/myapp
   *     tag: latest
   */
  private scanImageReferences(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const seen = new Set<string>();

    // Inline image reference: image: registry/name:tag
    const inlineImageRegex = /image:\s*["']?([a-zA-Z0-9._/-]+(?::[a-zA-Z0-9._-]+)?)["']?\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = inlineImageRegex.exec(content)) !== null) {
      const image = match[1];
      if (isExternalImage(image)) continue;

      const imageName = extractImageName(image);
      const matchingRepo = fuzzyMatchRepo(imageName, allRepoNames, repoName);
      if (matchingRepo) {
        const key = `${matchingRepo}|${imageName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Helm,
          confidence: Confidence.Medium,
          detail: `values.yaml image "${image}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    // Repository field within image block: repository: registry/name
    const repoImageRegex = /repository:\s*["']?([a-zA-Z0-9._/-]+)["']?\s*$/gm;
    while ((match = repoImageRegex.exec(content)) !== null) {
      const image = match[1];
      if (isExternalImage(image)) continue;

      const imageName = extractImageName(image);
      const matchingRepo = fuzzyMatchRepo(imageName, allRepoNames, repoName);
      if (matchingRepo) {
        const key = `${matchingRepo}|${imageName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Helm,
          confidence: Confidence.Medium,
          detail: `values.yaml image repository "${image}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }
  }

  /**
   * Detect serviceUrl, host, and similar patterns that reference other services.
   */
  private scanServiceReferences(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const seen = new Set<string>();
    // Match serviceUrl, baseUrl, host, hostname, endpoint patterns
    const serviceRefRegex =
      /(?:serviceUrl|service_url|baseUrl|base_url|host|hostname|endpoint|url):\s*["']?(https?:\/\/[^\s"']+|[a-zA-Z0-9][\w.-]+(?::\d+)?)["']?/gi;
    let match: RegExpExecArray | null;
    while ((match = serviceRefRegex.exec(content)) !== null) {
      const value = match[1];
      // Extract hostname from URLs for better fuzzy matching
      let matchValue = value;
      if (value.startsWith("http://") || value.startsWith("https://")) {
        try {
          const hostname = new URL(value).hostname;
          // Use first hostname segment (e.g., "user-service" from "user-service.internal.example.com")
          matchValue = hostname.split(".")[0];
        } catch {
          // Not a valid URL, use raw value
        }
      }
      const matchingRepo = fuzzyMatchRepo(matchValue, allRepoNames, repoName);
      if (matchingRepo) {
        const key = `${matchingRepo}|${matchValue}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Helm,
          confidence: Confidence.Medium,
          detail: `values.yaml service reference "${value}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }
  }

  /**
   * Resolve a chart dependency name against known repo names.
   */
  private resolveChartDependency(
    repoName: string,
    filePath: string,
    chartName: string,
    version: string | undefined,
    repository: string | undefined,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const matchingRepo = fuzzyMatchRepo(chartName, allRepoNames, repoName);

    if (matchingRepo) {
      const repoDetail = repository ? ` (repository: ${repository})` : "";
      const dep: DetectedDependency = {
        sourceRepo: repoName,
        targetRepo: matchingRepo,
        type: DependencyType.Helm,
        confidence: Confidence.High,
        detail: `Chart.yaml dependency "${chartName}"${repoDetail} matches repo "${matchingRepo}"`,
        sourceFile: filePath,
      };
      if (version) {
        dep.version = version;
      }
      deps.push(dep);
    }
  }
}
