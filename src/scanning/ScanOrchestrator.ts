import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IProjectPageService } from "azure-devops-extension-api";
import * as ApiClient from "../utils/ApiClient";
import { ConcurrencyLimiter } from "../utils/ConcurrencyLimiter";
import { MAX_CONCURRENT_REPOS } from "../utils/Constants";
import { CacheManager } from "../caching/CacheManager";
import { IncrementalScan } from "../caching/IncrementalScan";
import { discoverFiles } from "./FileDiscovery";
import { fetchFileContents, FileContent } from "./FileContentFetcher";
import { NuGetDetector } from "./detectors/NuGetDetector";
import { ApiCallDetector } from "./detectors/ApiCallDetector";
import { DatabaseDetector } from "./detectors/DatabaseDetector";
import { GoModuleDetector } from "./detectors/GoModuleDetector";
import { InfraDetector } from "./detectors/InfraDetector";
import { NpmDetector } from "./detectors/NpmDetector";
import { DockerDetector } from "./detectors/DockerDetector";
import { MavenDetector } from "./detectors/MavenDetector";
import { PythonDetector } from "./detectors/PythonDetector";
import { HelmDetector } from "./detectors/HelmDetector";
import { AppConfigDetector } from "./detectors/AppConfigDetector";
import { ServiceConnectionDetector } from "./detectors/ServiceConnectionDetector";
import { ServiceBusDetector } from "./detectors/ServiceBusDetector";
import { ServiceUsageDetector } from "./detectors/ServiceUsageDetector";
import { IDetector } from "./detectors/IDetector";
import { DetectedDependency, Language } from "../models/DependencyTypes";
import { ScanProgress, ServiceInstance } from "../models/DependencyGraph";
import { crossLinkInfraAndUsage } from "../analysis/CrossLinker";

export interface RepoMetadata {
  databases: string[];
  publishedPackages: string[];
  consumedServices: ServiceInstance[];
}

export interface ScanResult {
  dependencies: DetectedDependency[];
  repoLanguages: Map<string, Language>;
  repoUrls: Map<string, string>;
  infraResources: ReturnType<InfraDetector["getAllResources"]>;
  allRepoNames: string[];
  repoMetadata: Map<string, RepoMetadata>;
}

export class ScanOrchestrator {
  private cache: CacheManager;
  private nugetDetector = new NuGetDetector();
  private apiDetector = new ApiCallDetector();
  private dbDetector = new DatabaseDetector();
  private goDetector = new GoModuleDetector();
  private infraDetector = new InfraDetector();
  private npmDetector = new NpmDetector();
  private dockerDetector = new DockerDetector();
  private mavenDetector = new MavenDetector();
  private pythonDetector = new PythonDetector();
  private helmDetector = new HelmDetector();
  private appConfigDetector = new AppConfigDetector();
  private serviceConnectionDetector = new ServiceConnectionDetector();
  private serviceBusDetector = new ServiceBusDetector();
  private serviceUsageDetector = new ServiceUsageDetector();
  private detectors: IDetector[];
  private onProgress?: (progress: ScanProgress) => void;

  private signal?: AbortSignal;

  constructor(
    cache: CacheManager,
    onProgress?: (progress: ScanProgress) => void,
    signal?: AbortSignal
  ) {
    this.cache = cache;
    this.onProgress = onProgress;
    this.signal = signal;
    this.detectors = [
      this.nugetDetector,
      this.apiDetector,
      this.dbDetector,
      this.goDetector,
      this.infraDetector,
      this.npmDetector,
      this.dockerDetector,
      this.mavenDetector,
      this.pythonDetector,
      this.helmDetector,
      this.appConfigDetector,
      this.serviceConnectionDetector,
      this.serviceBusDetector,
      this.serviceUsageDetector,
    ];
  }

  private checkAbort(): void {
    if (this.signal?.aborted) {
      throw new DOMException("Scan cancelled", "AbortError");
    }
  }

  async scan(forceFullScan = false): Promise<ScanResult> {
    // Reset all detector state
    for (const detector of this.detectors) {
      detector.reset();
    }

    this.checkAbort();

    const projectService = await SDK.getService<IProjectPageService>(
      CommonServiceIds.ProjectPageService
    );
    const projectInfo = await projectService.getProject();
    if (!projectInfo) {
      throw new Error(
        "Could not determine the current project. Ensure this extension is running within a project context."
      );
    }
    const project = projectInfo.name;

    this.checkAbort();

    this.reportProgress("discovery", 0, 0, "", "Fetching repositories...");

    const repos = await ApiClient.getRepositories(project);
    const allRepoNames = repos.map((r) => r.name);
    const repoUrls = new Map<string, string>();
    repos.forEach((r) => {
      if (r.webUrl) repoUrls.set(r.name, r.webUrl);
    });

    this.checkAbort();

    // Incremental scan check
    let reposToScan = repos.map((r) => ({ id: r.id, name: r.name }));
    const incremental = new IncrementalScan(this.cache);
    let currentCommits: Record<string, string> = {};
    if (!forceFullScan) {
      const result = await incremental.getChangedRepos(reposToScan, project);
      reposToScan = result.changed;
      currentCommits = result.currentCommits;
    }

    const repoLanguages = new Map<string, Language>();
    const repoLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_REPOS);

    // Phase 1: Discover files, fetch content, register published packages
    this.reportProgress("scanning", reposToScan.length, 0, "", "Scanning repositories...");

    interface RepoContent {
      config: FileContent[];
      infra: FileContent[];
      source: FileContent[];
    }

    let completed = 0;
    const failedRepos: string[] = [];
    const repoContents = new Map<string, RepoContent>();

    await repoLimiter.map(reposToScan, async (repo) => {
      this.checkAbort();
      try {
        this.reportProgress(
          "scanning",
          reposToScan.length,
          completed,
          repo.name,
          `Scanning ${repo.name}...`
        );

        const discovered = await discoverFiles(repo.id, project);

        // Detect language (with path guard)
        const configPaths = discovered.configFiles
          .map((f) => f.path)
          .filter((p): p is string => !!p);

        if (configPaths.some((p) => /\.csproj$/i.test(p))) {
          repoLanguages.set(repo.name, Language.CSharp);
        } else if (configPaths.some((p) => /go\.mod$/i.test(p))) {
          repoLanguages.set(repo.name, Language.Go);
        } else if (configPaths.some((p) => /pom\.xml$/i.test(p) || /build\.gradle/i.test(p))) {
          repoLanguages.set(repo.name, Language.Java);
        } else if (
          configPaths.some(
            (p) =>
              /requirements\.txt$/i.test(p) || /pyproject\.toml$/i.test(p) || /setup\.py$/i.test(p)
          )
        ) {
          repoLanguages.set(repo.name, Language.Python);
        } else if (configPaths.some((p) => /package\.json$/i.test(p))) {
          repoLanguages.set(repo.name, Language.TypeScript);
        } else {
          repoLanguages.set(repo.name, Language.Unknown);
        }

        // Fetch config files
        const configContents = await fetchFileContents(repo.id, project, discovered.configFiles);

        // Fetch infra files
        let infraContents: FileContent[] = [];
        if (discovered.infraFiles.length > 0) {
          infraContents = await fetchFileContents(repo.id, project, discovered.infraFiles);
        }

        // Fetch source files if signals found
        let sourceContents: FileContent[] = [];
        if (discovered.hasSignals && discovered.sourceFiles.length > 0) {
          sourceContents = await fetchFileContents(repo.id, project, discovered.sourceFiles);
        }

        // Store fetched content for Phase 2
        repoContents.set(repo.name, {
          config: configContents,
          infra: infraContents,
          source: sourceContents,
        });

        // Register published packages (Phase 1 - registration only)
        const allFiles = [...configContents, ...infraContents, ...sourceContents];
        for (const file of allFiles) {
          for (const detector of this.detectors) {
            try {
              detector.registerPublished?.(repo.name, file.path, file.content);
            } catch (err) {
              console.warn(
                `[${detector.constructor.name}] registerPublished failed on ${file.path} in ${repo.name}:`,
                err
              );
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to scan repo ${repo.name}:`, err);
        failedRepos.push(repo.name);
      } finally {
        completed++;
        this.reportProgress(
          "scanning",
          reposToScan.length,
          completed,
          "",
          `Scanned ${completed} of ${reposToScan.length} repositories...`,
          failedRepos.length > 0 ? [...failedRepos] : undefined
        );
      }
    });

    // Phase 2: Run detection sequentially on cached content (all packages now registered)
    // Delete each repo's content after processing to free memory progressively.
    const allDeps: DetectedDependency[] = [];
    for (const [repoName, contents] of repoContents) {
      const files = [...contents.config, ...contents.infra, ...contents.source];
      const deps = this.runDetectors(repoName, files, allRepoNames);
      for (let i = 0; i < deps.length; i++) allDeps.push(deps[i]);
      repoContents.delete(repoName);
    }

    if (failedRepos.length > 0) {
      console.warn(`Scan completed with ${failedRepos.length} failed repos:`, failedRepos);
    }

    // Store commits only for successfully scanned repos (exclude failed ones)
    if (!forceFullScan && Object.keys(currentCommits).length > 0) {
      for (const failedName of failedRepos) {
        const failedRepo = repos.find((r) => r.name === failedName);
        if (failedRepo) delete currentCommits[failedRepo.id];
      }
      incremental.storeCommits(project, currentCommits);
    }

    this.reportProgress(
      "complete",
      reposToScan.length,
      reposToScan.length,
      "",
      failedRepos.length > 0 ? `Scan complete (${failedRepos.length} failed)` : "Scan complete",
      failedRepos
    );

    // Phase 3: Cross-link infra provisioning with service consumption
    const crossLinkedDeps = crossLinkInfraAndUsage(this.infraDetector, this.serviceUsageDetector);
    for (const dep of crossLinkedDeps) allDeps.push(dep);

    const repoMetadata = this.collectRepoMetadata(allRepoNames);

    return {
      dependencies: allDeps,
      repoLanguages,
      repoUrls,
      infraResources: this.infraDetector.getAllResources(),
      allRepoNames,
      repoMetadata,
    };
  }

  private runDetectors(
    repoName: string,
    files: FileContent[],
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];
    for (const file of files) {
      for (const detector of this.detectors) {
        try {
          const detected = detector.detect(repoName, file.path, file.content, allRepoNames);
          for (let i = 0; i < detected.length; i++) deps.push(detected[i]);
        } catch (err) {
          console.warn(`Detector error on ${file.path} in ${repoName}:`, err);
        }
      }
    }
    return deps;
  }

  private collectRepoMetadata(allRepoNames: string[]): Map<string, RepoMetadata> {
    const metadata = new Map<string, RepoMetadata>();

    // Invert database owners: dbName -> Set<repo> → per-repo DB list
    const dbOwners = this.dbDetector.getDatabaseOwners();
    const repoDbMap = new Map<string, Set<string>>();
    for (const [db, repos] of dbOwners) {
      for (const repo of repos) {
        if (!repoDbMap.has(repo)) repoDbMap.set(repo, new Set());
        repoDbMap.get(repo)!.add(db);
      }
    }

    // Invert published packages: pkgName -> publisherRepo → per-repo pkg list
    const publishedPkgs = this.nugetDetector.getPublishedPackages();
    const repoPkgMap = new Map<string, Set<string>>();
    for (const [pkg, repo] of publishedPkgs) {
      if (!repoPkgMap.has(repo)) repoPkgMap.set(repo, new Set());
      repoPkgMap.get(repo)!.add(pkg);
    }

    // Service usage from ServiceUsageDetector
    const repoServices = this.serviceUsageDetector.getRepoServices();

    for (const name of allRepoNames) {
      const dbs = repoDbMap.get(name);
      const pkgs = repoPkgMap.get(name);
      const services = repoServices.get(name);

      metadata.set(name, {
        databases: dbs ? [...dbs].filter((d) => !d.startsWith("sp:")) : [],
        publishedPackages: pkgs ? [...pkgs] : [],
        consumedServices: services
          ? services.map((s) => ({
              serviceType: s.serviceType,
              instanceId: s.instanceId,
              detectedFrom: s.detectedFrom,
            }))
          : [],
      });
    }

    return metadata;
  }

  private reportProgress(
    phase: ScanProgress["phase"],
    total: number,
    completed: number,
    currentRepo: string,
    message: string,
    failedRepos?: string[]
  ): void {
    if (this.onProgress) {
      this.onProgress({
        phase,
        reposTotal: total,
        reposCompleted: completed,
        currentRepo,
        message,
        failedRepos,
      });
    }
  }
}
