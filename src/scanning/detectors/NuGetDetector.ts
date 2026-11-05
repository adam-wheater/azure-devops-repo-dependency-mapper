import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import {
  PACKAGE_REFERENCE_REGEX,
  PACKAGE_ID_REGEX,
  NUSPEC_ID_REGEX,
  PACKAGE_VERSION_CPM_REGEX,
  PROJECT_REFERENCE_REGEX,
  IMPORT_PROJECT_REGEX,
  ASSEMBLY_NAME_REGEX,
  IS_PACKABLE_FALSE_REGEX,
  fuzzyMatchRepo,
} from "../../utils/Constants";
import { IDetector } from "./IDetector";

export class NuGetDetector implements IDetector {
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

  getPublishedPackages(): Map<string, string> {
    return this.publishedPackages;
  }

  registerPublished(repoName: string, _filePath: string, content: string): void {
    this.registerPublishedPackages(repoName, content);
  }

  /**
   * Register packages that this repo publishes.
   * Sources: <PackageId>, <AssemblyName> (fallback), <id> from .nuspec.
   * Skips registration if <IsPackable>false</IsPackable> is present.
   */
  private registerPublishedPackages(repoName: string, content: string): void {
    // If the project is explicitly not packable, don't register it as a publisher
    if (IS_PACKABLE_FALSE_REGEX.test(content)) return;

    let match: RegExpExecArray | null;
    let hasPackageId = false;

    // From .csproj <PackageId>
    const pkgIdRegex = new RegExp(PACKAGE_ID_REGEX.source, "gi");
    while ((match = pkgIdRegex.exec(content)) !== null) {
      this.publishedPackages.set(match[1].trim().toLowerCase(), repoName);
      hasPackageId = true;
    }

    // From .nuspec <id>
    const nuspecRegex = new RegExp(NUSPEC_ID_REGEX.source, "gi");
    while ((match = nuspecRegex.exec(content)) !== null) {
      this.publishedPackages.set(match[1].trim().toLowerCase(), repoName);
      hasPackageId = true;
    }

    // Fallback: <AssemblyName> when no <PackageId> is present
    if (!hasPackageId) {
      const asmRegex = new RegExp(ASSEMBLY_NAME_REGEX.source, "gi");
      while ((match = asmRegex.exec(content)) !== null) {
        this.publishedPackages.set(match[1].trim().toLowerCase(), repoName);
      }
    }
  }

  /**
   * Register centrally-managed package versions from Directory.Packages.props.
   * These <PackageVersion> entries don't indicate a dependency themselves,
   * but they tell us which packages are used across the repo.
   */
  private registerCPMVersions(repoName: string, content: string): void {
    const regex = new RegExp(PACKAGE_VERSION_CPM_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const packageName = match[1];
      const packageLower = packageName.toLowerCase();

      // CPM entries are consumed packages, not published ones.
      // Check if any other repo publishes this package.
      const publisherRepo = this.publishedPackages.get(packageLower);
      if (publisherRepo && publisherRepo !== repoName) {
        // Will be picked up when individual csproj files reference this package.
        // No action needed here — we just ensure the CPM file doesn't break detection.
      }
    }
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    // Register any published packages in this file
    this.registerPublishedPackages(repoName, content);

    // Handle CPM files (Directory.Packages.props)
    if (/Directory\.Packages\.props$/i.test(filePath)) {
      this.registerCPMVersions(repoName, content);
      // Also detect dependencies from CPM PackageVersion entries
      this.detectCPMDependencies(repoName, filePath, content, allRepoNames, deps);
    }

    // Find consumed PackageReferences (now matches with or without Version attribute)
    this.detectPackageReferences(repoName, filePath, content, allRepoNames, deps);

    // ProjectReference — cross-repo project dependencies
    this.detectProjectReferences(repoName, filePath, content, allRepoNames, deps);

    // <Import Project="..."> — cross-repo MSBuild imports
    this.detectImportReferences(repoName, filePath, content, allRepoNames, deps);

    // packages.config format (legacy)
    this.detectPackagesConfig(repoName, filePath, content, allRepoNames, deps);

    return deps;
  }

  /**
   * Detect dependencies from <PackageReference Include="..."> elements.
   * Works with or without a Version attribute (supports CPM consumers).
   */
  private detectPackageReferences(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const pkgRefRegex = new RegExp(PACKAGE_REFERENCE_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = pkgRefRegex.exec(content)) !== null) {
      const packageName = match[1];
      this.resolvePackageDependency(
        repoName,
        filePath,
        packageName,
        allRepoNames,
        deps,
        "PackageReference"
      );
    }
  }

  /**
   * Detect dependencies from <PackageVersion> entries in Directory.Packages.props.
   * These are centrally managed — each entry is an internal dependency if it matches.
   */
  private detectCPMDependencies(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const regex = new RegExp(PACKAGE_VERSION_CPM_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const packageName = match[1];
      this.resolvePackageDependency(
        repoName,
        filePath,
        packageName,
        allRepoNames,
        deps,
        "CPM PackageVersion"
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
    allRepoNames: string[],
    deps: DetectedDependency[],
    source: string
  ): void {
    const packageLower = packageName.toLowerCase();

    // Exact match against published packages registry
    const publisherRepo = this.publishedPackages.get(packageLower);
    if (publisherRepo && publisherRepo !== repoName) {
      const edgeKey = `${publisherRepo}|${filePath}|${packageLower}`;
      if (this.seenEdges.has(edgeKey)) return;
      this.seenEdges.add(edgeKey);
      deps.push({
        sourceRepo: repoName,
        targetRepo: publisherRepo,
        type: DependencyType.NuGet,
        confidence: Confidence.High,
        detail: `${source} "${packageName}" published by ${publisherRepo}`,
        sourceFile: filePath,
      });
      return;
    }

    // Heuristic: package name matches a repo name
    const matchingRepo = fuzzyMatchRepo(packageName, allRepoNames, repoName);
    if (matchingRepo) {
      const edgeKey = `${matchingRepo}|${filePath}|${packageLower}`;
      if (this.seenEdges.has(edgeKey)) return;
      this.seenEdges.add(edgeKey);
      deps.push({
        sourceRepo: repoName,
        targetRepo: matchingRepo,
        type: DependencyType.NuGet,
        confidence: Confidence.Medium,
        detail: `${source} "${packageName}" matches repo "${matchingRepo}"`,
        sourceFile: filePath,
      });
    }
  }

  /**
   * Detect <ProjectReference Include="path"> elements.
   * Extracts the project name from the path and matches against repo names.
   */
  private detectProjectReferences(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const regex = new RegExp(PROJECT_REFERENCE_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const refPath = match[1];
      // Extract project name: last path segment without extension
      const segments = refPath.replace(/\\/g, "/").split("/");
      const fileName = segments[segments.length - 1];
      const projectName = fileName.replace(/\.[^.]+$/, "");

      // Try to match against known repos
      const matchingRepo = fuzzyMatchRepo(projectName, allRepoNames, repoName);
      if (matchingRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.NuGet,
          confidence: Confidence.Medium,
          detail: `ProjectReference "${refPath}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }
  }

  /**
   * Detect <Import Project="path"> elements (cross-repo MSBuild imports).
   * Skips SDK and NuGet-generated imports.
   */
  private detectImportReferences(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const regex = new RegExp(IMPORT_PROJECT_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1];
      if (/Sdk\./i.test(importPath) || /\.targets$/i.test(importPath)) continue;
      if (/nuget/i.test(importPath) || /\.nuget/i.test(importPath)) continue;

      const segments = importPath.replace(/\\/g, "/").split("/");
      // Try matching each meaningful path segment (file name without extension + directories)
      let matchingRepo: string | null = null;
      for (let i = segments.length - 1; i >= 0 && !matchingRepo; i--) {
        const seg = segments[i].replace(/\.[^.]+$/, "");
        if (seg === ".." || seg === ".") continue;
        matchingRepo = fuzzyMatchRepo(seg, allRepoNames, repoName);
      }

      if (matchingRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.NuGet,
          confidence: Confidence.Medium,
          detail: `Import Project="${importPath}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }
  }

  /**
   * Detect dependencies from packages.config <package id="..." version="..."/>.
   * Now includes heuristic repo name matching (previously only exact publisher match).
   */
  private detectPackagesConfig(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    const packagesConfigRegex = /<package\s+id="([^"]+)"\s+version="([^"]+)"/gi;
    let match: RegExpExecArray | null;
    while ((match = packagesConfigRegex.exec(content)) !== null) {
      const packageName = match[1];
      this.resolvePackageDependency(
        repoName,
        filePath,
        packageName,
        allRepoNames,
        deps,
        "packages.config"
      );
    }
  }
}
