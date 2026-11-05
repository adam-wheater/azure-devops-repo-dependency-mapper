/**
 * Integration tests for ScanOrchestrator.
 * Mocks the Azure DevOps SDK and API to simulate a multi-repo scan.
 */

import { ScanOrchestrator, ScanResult } from "../../src/scanning/ScanOrchestrator";
import { CacheManager } from "../../src/caching/CacheManager";
import { DependencyType, Confidence, Language } from "../../src/models/DependencyTypes";
import { ScanProgress } from "../../src/models/DependencyGraph";

// ---- Test data (used by mock factories via getter) ----

function getFakeRepoFiles(): Record<string, Record<string, string>> {
  return {
    "repo-id-backend": {
      "/src/Backend.csproj": `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <PackageId>Contoso.Backend</PackageId>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Contoso.SharedLib" Version="1.0.0" />
  </ItemGroup>
</Project>`,
      "/appsettings.json": JSON.stringify({
        Redis: { ConnectionString: "myredis.redis.cache.windows.net:6380,password=abc" },
      }),
    },
    "repo-id-shared": {
      "/src/SharedLib.csproj": `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <PackageId>Contoso.SharedLib</PackageId>
  </PropertyGroup>
</Project>`,
    },
    "repo-id-infra": {
      "/infra/main.bicep": `
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: 'myredis'
  location: 'eastus'
}
`,
    },
  };
}

function getFakeRepos() {
  return [
    {
      id: "repo-id-backend",
      name: "backend-service",
      webUrl: "https://dev.azure.com/org/proj/_git/backend-service",
    },
    {
      id: "repo-id-shared",
      name: "shared-lib",
      webUrl: "https://dev.azure.com/org/proj/_git/shared-lib",
    },
    {
      id: "repo-id-infra",
      name: "infra-repo",
      webUrl: "https://dev.azure.com/org/proj/_git/infra-repo",
    },
  ];
}

// ---- Mocks ----

jest.mock("azure-devops-extension-sdk", () => ({
  getService: jest.fn().mockResolvedValue({
    getProject: jest.fn().mockResolvedValue({ name: "TestProject" }),
  }),
}));

jest.mock("../../src/scanning/FileDiscovery", () => ({
  discoverFiles: jest.fn().mockImplementation((repoId: string) => {
    const files = getFakeRepoFiles()[repoId] || {};
    const paths = Object.keys(files);
    const configFiles = paths
      .filter((p) => /\.(csproj|json)$/i.test(p))
      .map((p) => ({ path: p, isFolder: false }));
    const infraFiles = paths
      .filter((p) => /\.bicep$/i.test(p))
      .map((p) => ({ path: p, isFolder: false }));
    const sourceFiles = paths
      .filter((p) => /\.cs$/i.test(p))
      .map((p) => ({ path: p, isFolder: false }));
    return Promise.resolve({
      configFiles,
      sourceFiles,
      infraFiles,
      hasSignals: sourceFiles.length > 0,
    });
  }),
}));

jest.mock("../../src/scanning/FileContentFetcher", () => ({
  fetchFileContents: jest
    .fn()
    .mockImplementation((repoId: string, _project: string, items: { path: string }[]) => {
      const files = getFakeRepoFiles()[repoId] || {};
      return Promise.resolve(
        items
          .filter((item) => files[item.path])
          .map((item) => ({
            path: item.path,
            content: files[item.path],
          }))
      );
    }),
}));

jest.mock("../../src/utils/ApiClient", () => ({
  getRepositories: jest.fn().mockImplementation(() => Promise.resolve(getFakeRepos())),
  getHeadCommitId: jest.fn().mockResolvedValue("abc123"),
  getItems: jest.fn().mockResolvedValue([]),
  getItemText: jest.fn().mockResolvedValue(""),
}));

// ---- Tests ----

describe("ScanOrchestrator integration", () => {
  let cache: CacheManager;
  let progressCalls: ScanProgress[];

  beforeEach(() => {
    cache = new CacheManager();
    progressCalls = [];
  });

  test("full scan discovers repos, detects NuGet dependency, and returns metadata", async () => {
    const orchestrator = new ScanOrchestrator(cache, (p) => progressCalls.push({ ...p }));
    const result: ScanResult = await orchestrator.scan(true);

    // Should find all 3 repos
    expect(result.allRepoNames).toHaveLength(3);
    expect(result.allRepoNames).toContain("backend-service");
    expect(result.allRepoNames).toContain("shared-lib");
    expect(result.allRepoNames).toContain("infra-repo");

    // Should set repo URLs
    expect(result.repoUrls.get("backend-service")).toContain("backend-service");

    // Should detect language for backend (CSharp - has .csproj)
    expect(result.repoLanguages.get("backend-service")).toBe(Language.CSharp);
    expect(result.repoLanguages.get("shared-lib")).toBe(Language.CSharp);

    // Should detect NuGet dependency: backend-service → shared-lib via Contoso.SharedLib
    const nugetDeps = result.dependencies.filter((d) => d.type === DependencyType.NuGet);
    expect(nugetDeps.length).toBeGreaterThanOrEqual(1);
    const sharedLibDep = nugetDeps.find(
      (d) => d.sourceRepo === "backend-service" && d.targetRepo === "shared-lib"
    );
    expect(sharedLibDep).toBeDefined();
    expect(sharedLibDep!.confidence).toBe(Confidence.High);
    expect(sharedLibDep!.detail).toContain("Contoso.SharedLib");
  });

  test("progress callbacks fire in order", async () => {
    const orchestrator = new ScanOrchestrator(cache, (p) => progressCalls.push({ ...p }));
    await orchestrator.scan(true);

    expect(progressCalls.length).toBeGreaterThan(0);
    // Should start with discovery phase
    expect(progressCalls[0].phase).toBe("discovery");
    // Should end with complete
    const lastProgress = progressCalls[progressCalls.length - 1];
    expect(lastProgress.phase).toBe("complete");
  });

  test("cross-linking creates infra dependency from consumer to provisioner", async () => {
    const orchestrator = new ScanOrchestrator(cache);
    const result = await orchestrator.scan(true);

    // backend-service consumes Redis "myredis" (from appsettings.json via ServiceUsageDetector)
    // infra-repo provisions Redis "myredis" (from main.bicep via InfraDetector)
    // Cross-linking should create: backend-service → infra-repo (Infrastructure)
    const infraDeps = result.dependencies.filter(
      (d) =>
        d.type === DependencyType.Infrastructure &&
        d.sourceRepo === "backend-service" &&
        d.targetRepo === "infra-repo"
    );
    expect(infraDeps.length).toBeGreaterThanOrEqual(1);
    expect(infraDeps[0].detail).toContain("myredis");
  });

  test("infra resources are returned in scan result", async () => {
    const orchestrator = new ScanOrchestrator(cache);
    const result = await orchestrator.scan(true);

    expect(result.infraResources.length).toBeGreaterThan(0);
    const redis = result.infraResources.find((r) => r.resourceName === "myredis");
    expect(redis).toBeDefined();
    expect(redis!.repo).toBe("infra-repo");
  });

  test("repo metadata includes published packages", async () => {
    const orchestrator = new ScanOrchestrator(cache);
    const result = await orchestrator.scan(true);

    const sharedMeta = result.repoMetadata.get("shared-lib");
    expect(sharedMeta).toBeDefined();
    expect(sharedMeta!.publishedPackages).toContain("contoso.sharedlib");
  });

  test("repo metadata includes consumed services", async () => {
    const orchestrator = new ScanOrchestrator(cache);
    const result = await orchestrator.scan(true);

    const backendMeta = result.repoMetadata.get("backend-service");
    expect(backendMeta).toBeDefined();
    const redisService = backendMeta!.consumedServices.find(
      (s) => s.serviceType.toLowerCase() === "redis"
    );
    expect(redisService).toBeDefined();
    expect(redisService!.instanceId).toContain("myredis");
  });

  test("scan resets detector state between runs", async () => {
    const orchestrator = new ScanOrchestrator(cache);

    // First scan
    const result1 = await orchestrator.scan(true);
    const depCount1 = result1.dependencies.length;

    // Second scan should produce same results (not accumulate)
    const result2 = await orchestrator.scan(true);
    expect(result2.dependencies.length).toBe(depCount1);
  });
});
