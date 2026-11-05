import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { fuzzyMatchRepo } from "../../utils/Constants";
import { IDetector } from "./IDetector";

export class MavenDetector implements IDetector {
  private publishedArtifacts: Map<string, string> = new Map();
  private seenEdges = new Set<string>();

  reset(): void {
    this.publishedArtifacts.clear();
    this.seenEdges.clear();
  }

  /** @deprecated Use reset() instead */
  resetPublishedArtifacts(): void {
    this.reset();
  }

  registerPublished(repoName: string, filePath: string, content: string): void {
    if (/pom\.xml$/i.test(filePath)) {
      this.registerPomArtifacts(repoName, content);
    }
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (/pom\.xml$/i.test(filePath)) {
      this.registerPomArtifacts(repoName, content);
      this.scanPom(repoName, filePath, content, allRepoNames, deps);
    } else if (/build\.gradle(\.kts)?$/i.test(filePath)) {
      this.scanGradle(repoName, filePath, content, allRepoNames, deps);
    }

    return deps;
  }

  /**
   * Register artifacts published by this repo from pom.xml.
   * Uses the top-level <groupId> + <artifactId> (outside of <dependencies> and <parent>).
   */
  private registerPomArtifacts(repoName: string, content: string): void {
    // Extract the project-level groupId and artifactId (not inside <dependencies> or <parent>)
    // Remove <dependencies>...</dependencies> and <parent>...</parent> blocks to isolate project-level declarations
    const stripped = content
      .replace(/<dependencies>[\s\S]*?<\/dependencies>/gi, "")
      .replace(/<parent>[\s\S]*?<\/parent>/gi, "")
      .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/gi, "");

    const groupIdMatch = /<groupId>\s*([^<]+?)\s*<\/groupId>/i.exec(stripped);
    const artifactIdMatch = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/i.exec(stripped);

    if (groupIdMatch && artifactIdMatch) {
      const key = `${groupIdMatch[1].trim()}:${artifactIdMatch[1].trim()}`.toLowerCase();
      this.publishedArtifacts.set(key, repoName);
    }
  }

  /**
   * Scan pom.xml for <dependency> and <parent> references.
   */
  private scanPom(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Detect <dependency> blocks
    const depBlockRegex = /<dependency>\s*([\s\S]*?)\s*<\/dependency>/gi;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = depBlockRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      const groupId = this.extractXmlElement(block, "groupId");
      const artifactId = this.extractXmlElement(block, "artifactId");
      const version = this.extractXmlElement(block, "version");

      if (groupId && artifactId) {
        this.resolveArtifactDependency(
          repoName,
          filePath,
          groupId,
          artifactId,
          version || undefined,
          allRepoNames,
          deps,
          "Maven dependency"
        );
      }
    }

    // Detect <parent> block
    const parentRegex = /<parent>\s*([\s\S]*?)\s*<\/parent>/gi;
    let parentMatch: RegExpExecArray | null;
    while ((parentMatch = parentRegex.exec(content)) !== null) {
      const block = parentMatch[1];
      const groupId = this.extractXmlElement(block, "groupId");
      const artifactId = this.extractXmlElement(block, "artifactId");
      const version = this.extractXmlElement(block, "version");

      if (groupId && artifactId) {
        this.resolveArtifactDependency(
          repoName,
          filePath,
          groupId,
          artifactId,
          version || undefined,
          allRepoNames,
          deps,
          "Maven parent"
        );
      }
    }
  }

  /**
   * Scan build.gradle / build.gradle.kts for dependency declarations.
   */
  private scanGradle(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Match patterns like:
    //   implementation 'group:artifact:version'
    //   implementation "group:artifact:version"
    //   compile 'group:artifact:version'
    //   compile "group:artifact:version"
    //   api 'group:artifact:version'
    //   testImplementation 'group:artifact:version'
    const gradleDepRegex =
      /(?:implementation|compile|api|testImplementation|testCompile|runtimeOnly|compileOnly)\s*[('"]([^'"()]+)['")\s]/gi;
    let match: RegExpExecArray | null;
    while ((match = gradleDepRegex.exec(content)) !== null) {
      const depString = match[1].trim();
      // Expect group:artifact:version or group:artifact
      const parts = depString.split(":");
      if (parts.length >= 2) {
        const groupId = parts[0];
        const artifactId = parts[1];
        const version = parts.length >= 3 ? parts[2] : undefined;

        this.resolveArtifactDependency(
          repoName,
          filePath,
          groupId,
          artifactId,
          version,
          allRepoNames,
          deps,
          "Gradle dependency"
        );
      }
    }

    // Also match Kotlin DSL style: implementation("group:artifact:version")
    const kotlinDslRegex =
      /(?:implementation|compile|api|testImplementation|testCompile|runtimeOnly|compileOnly)\s*\(\s*["']([^"']+)["']\s*\)/gi;
    while ((match = kotlinDslRegex.exec(content)) !== null) {
      const depString = match[1].trim();
      const parts = depString.split(":");
      if (parts.length >= 2) {
        const groupId = parts[0];
        const artifactId = parts[1];
        const version = parts.length >= 3 ? parts[2] : undefined;

        this.resolveArtifactDependency(
          repoName,
          filePath,
          groupId,
          artifactId,
          version,
          allRepoNames,
          deps,
          "Gradle dependency"
        );
      }
    }
  }

  /**
   * Core resolution: given a groupId:artifactId, check if it's published by another repo
   * or heuristically matches a repo name.
   */
  private resolveArtifactDependency(
    repoName: string,
    filePath: string,
    groupId: string,
    artifactId: string,
    version: string | undefined,
    allRepoNames: string[],
    deps: DetectedDependency[],
    source: string
  ): void {
    const artifactKey = `${groupId}:${artifactId}`.toLowerCase();

    // Exact match against published artifacts registry
    const publisherRepo = this.publishedArtifacts.get(artifactKey);
    if (publisherRepo && publisherRepo !== repoName) {
      const edgeKey = `${publisherRepo}|${filePath}|${artifactKey}`;
      if (this.seenEdges.has(edgeKey)) return;
      this.seenEdges.add(edgeKey);
      const dep: DetectedDependency = {
        sourceRepo: repoName,
        targetRepo: publisherRepo,
        type: DependencyType.Maven,
        confidence: Confidence.High,
        detail: `${source} "${groupId}:${artifactId}" published by ${publisherRepo}`,
        sourceFile: filePath,
      };
      if (version) {
        dep.version = version;
      }
      deps.push(dep);
      return;
    }

    // Heuristic: artifactId matches a repo name
    const matchingRepo = fuzzyMatchRepo(artifactId, allRepoNames, repoName);
    if (matchingRepo) {
      const edgeKey = `${matchingRepo}|${filePath}|${artifactKey}`;
      if (this.seenEdges.has(edgeKey)) return;
      this.seenEdges.add(edgeKey);
      const dep: DetectedDependency = {
        sourceRepo: repoName,
        targetRepo: matchingRepo,
        type: DependencyType.Maven,
        confidence: Confidence.Medium,
        detail: `${source} "${groupId}:${artifactId}" matches repo "${matchingRepo}"`,
        sourceFile: filePath,
      };
      if (version) {
        dep.version = version;
      }
      deps.push(dep);
    }
  }

  /**
   * Extract the text content of an XML element by tag name.
   */
  private extractXmlElement(xml: string, tagName: string): string | null {
    const regex = new RegExp(`<${tagName}>\\s*([^<]+?)\\s*</${tagName}>`, "i");
    const match = regex.exec(xml);
    return match ? match[1] : null;
  }
}
