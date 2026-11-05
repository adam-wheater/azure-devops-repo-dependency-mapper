import { NuGetDetector } from "../../src/scanning/detectors/NuGetDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("NuGetDetector", () => {
  let detector: NuGetDetector;
  const allRepos = ["auth-service", "common-models", "order-api", "shared-lib"];

  beforeEach(() => {
    detector = new NuGetDetector();
    detector.resetPublishedPackages();
  });

  // --- PackageReference (inline Version) ---

  test("detects PackageReference matching repo name (heuristic)", () => {
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">
      <ItemGroup>
        <PackageReference Include="AuthService.Client" Version="1.0.0" />
        <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "src/Order.Api.csproj", csproj, allRepos);

    expect(deps.length).toBeGreaterThan(0);
    const authDep = deps.find((d) => d.targetRepo === "auth-service");
    expect(authDep).toBeDefined();
    expect(authDep!.type).toBe(DependencyType.NuGet);
    expect(authDep!.confidence).toBe(Confidence.Medium);
  });

  test("detects published PackageId and creates high-confidence edge", () => {
    // Register publisher
    const publisherCsproj = `<Project>
      <PropertyGroup><PackageId>Contoso.AuthService</PackageId></PropertyGroup>
    </Project>`;
    detector.detect("auth-service", "Auth.csproj", publisherCsproj, allRepos);

    // Consumer
    const consumerCsproj = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.AuthService" Version="1.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumerCsproj, allRepos);

    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      sourceRepo: "order-api",
      targetRepo: "auth-service",
      type: DependencyType.NuGet,
      confidence: Confidence.High,
    });
  });

  test("ignores external NuGet packages with no repo match", () => {
    const csproj = `<Project>
      <ItemGroup>
        <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
        <PackageReference Include="Serilog" Version="3.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "test.csproj", csproj, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("detects packages.config format with heuristic matching", () => {
    // Register publisher first
    const pub = `<Project><PropertyGroup><PackageId>Contoso.AuthService</PackageId></PropertyGroup></Project>`;
    detector.detect("auth-service", "a.csproj", pub, allRepos);

    const config = `<?xml version="1.0" encoding="utf-8"?>
    <packages>
      <package id="Contoso.AuthService" version="1.0.0" targetFramework="net48" />
    </packages>`;
    const deps = detector.detect("order-api", "packages.config", config, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("auth-service");
  });

  // --- Version-less PackageReference (CPM) ---

  test("detects version-less PackageReference (CPM consumer)", () => {
    // Register publisher
    const pub = `<Project><PropertyGroup><PackageId>Contoso.SharedLib</PackageId></PropertyGroup></Project>`;
    detector.detect("shared-lib", "SharedLib.csproj", pub, allRepos);

    // CPM consumer — no Version attribute
    const consumer = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.SharedLib" />
        <PackageReference Include="Newtonsoft.Json" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumer, allRepos);

    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      targetRepo: "shared-lib",
      confidence: Confidence.High,
    });
  });

  test("detects multi-line PackageReference with attributes on separate lines", () => {
    const csproj = `<Project>
      <ItemGroup>
        <PackageReference
          Include="AuthService.Client"
          Version="2.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "test.csproj", csproj, allRepos);
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
  });

  // --- CPM Directory.Packages.props ---

  test("detects dependencies from Directory.Packages.props PackageVersion entries", () => {
    // Register publisher
    const pub = `<Project><PropertyGroup><PackageId>Contoso.AuthService</PackageId></PropertyGroup></Project>`;
    detector.detect("auth-service", "Auth.csproj", pub, allRepos);

    // CPM file
    const cpm = `<Project>
      <ItemGroup>
        <PackageVersion Include="Contoso.AuthService" Version="2.0.0" />
        <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Directory.Packages.props", cpm, allRepos);

    const authDep = deps.find((d) => d.targetRepo === "auth-service");
    expect(authDep).toBeDefined();
    expect(authDep!.confidence).toBe(Confidence.High);
    expect(authDep!.detail).toContain("CPM PackageVersion");
  });

  // --- ProjectReference ---

  test("detects ProjectReference matching a repo name", () => {
    const csproj = `<Project>
      <ItemGroup>
        <ProjectReference Include="..\\..\\shared\\CommonModels\\CommonModels.csproj" />
        <ProjectReference Include="..\\internal\\Unrelated.csproj" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "src/Order.csproj", csproj, allRepos);

    const commonDep = deps.find((d) => d.targetRepo === "common-models");
    expect(commonDep).toBeDefined();
    expect(commonDep!.confidence).toBe(Confidence.Medium);
    expect(commonDep!.detail).toContain("ProjectReference");

    // "Unrelated" should not match any repo
    expect(deps.filter((d) => d.detail.includes("Unrelated"))).toHaveLength(0);
  });

  // --- AssemblyName fallback ---

  test("uses AssemblyName as publisher identity when no PackageId exists", () => {
    // Publisher with AssemblyName but no PackageId
    const pub = `<Project>
      <PropertyGroup>
        <AssemblyName>Contoso.CommonModels</AssemblyName>
        <TargetFramework>net8.0</TargetFramework>
      </PropertyGroup>
    </Project>`;
    detector.detect("common-models", "Common.csproj", pub, allRepos);

    // Consumer
    const consumer = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.CommonModels" Version="1.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumer, allRepos);

    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      targetRepo: "common-models",
      confidence: Confidence.High,
    });
  });

  test("prefers PackageId over AssemblyName when both present", () => {
    // Publisher with both PackageId and AssemblyName
    const pub = `<Project>
      <PropertyGroup>
        <PackageId>Contoso.Auth</PackageId>
        <AssemblyName>Contoso.Auth.Internal</AssemblyName>
      </PropertyGroup>
    </Project>`;
    detector.detect("auth-service", "Auth.csproj", pub, allRepos);

    // Consumer references PackageId
    const consumer = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.Auth" Version="1.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumer, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("auth-service");
  });

  // --- IsPackable filtering ---

  test("skips publisher registration when IsPackable is false", () => {
    // Test project that shouldn't be treated as a publisher
    const testProj = `<Project>
      <PropertyGroup>
        <PackageId>Contoso.AuthService.Tests</PackageId>
        <IsPackable>false</IsPackable>
      </PropertyGroup>
    </Project>`;
    detector.detect("auth-service", "Tests.csproj", testProj, allRepos);

    // Consumer tries to reference the test project's PackageId
    const consumer = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.AuthService.Tests" Version="1.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumer, allRepos);

    // Should NOT get a High-confidence match via publishedPackages
    // May still get a Medium heuristic match against "auth-service" repo name
    const highDeps = deps.filter((d) => d.confidence === Confidence.High);
    expect(highDeps).toHaveLength(0);
  });

  // --- Import Project ---

  test("detects Import Project references matching a repo name", () => {
    const csproj = `<Project>
      <Import Project="..\\..\\shared-lib\\Build.props" />
      <Import Project="Sdk.targets" />
      <Import Project="$(NuGetPackageRoot)\\foo.targets" />
    </Project>`;
    const deps = detector.detect("order-api", "src/Order.csproj", csproj, allRepos);
    const importDep = deps.find((d) => d.detail.includes("Import Project"));
    expect(importDep).toBeDefined();
    expect(importDep!.targetRepo).toBe("shared-lib");
    // Sdk.targets and NuGet imports should be skipped
    expect(deps.filter((d) => d.detail.includes("Sdk.targets"))).toHaveLength(0);
    expect(deps.filter((d) => d.detail.includes("nuget"))).toHaveLength(0);
  });

  // --- Dedup correctness ---

  test("preserves both details when two different packages resolve to the same repo", () => {
    // Register two packages published by auth-service
    const pub = `<Project>
      <PropertyGroup><PackageId>Contoso.Auth</PackageId></PropertyGroup>
    </Project>`;
    detector.detect("auth-service", "Auth.csproj", pub, allRepos);

    // Manually register a second package for the same repo
    const pub2 = `<Project>
      <PropertyGroup><PackageId>Contoso.Auth.Client</PackageId></PropertyGroup>
    </Project>`;
    detector.detect("auth-service", "Auth.Client.csproj", pub2, allRepos);

    // Consumer references both packages
    const consumer = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.Auth" Version="1.0.0" />
        <PackageReference Include="Contoso.Auth.Client" Version="1.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumer, allRepos);

    // Both packages should produce deps (not deduped since they're different packages)
    expect(deps).toHaveLength(2);
    expect(deps.some((d) => d.detail.includes('"Contoso.Auth"'))).toBe(true);
    expect(deps.some((d) => d.detail.includes('"Contoso.Auth.Client"'))).toBe(true);
  });

  test("deduplicates the same package referenced multiple times in one file", () => {
    const pub = `<Project>
      <PropertyGroup><PackageId>Contoso.Auth</PackageId></PropertyGroup>
    </Project>`;
    detector.detect("auth-service", "Auth.csproj", pub, allRepos);

    // File that references the same package twice (malformed XML edge case)
    const consumer = `<Project>
      <ItemGroup>
        <PackageReference Include="Contoso.Auth" Version="1.0.0" />
        <PackageReference Include="Contoso.Auth" Version="2.0.0" />
      </ItemGroup>
    </Project>`;
    const deps = detector.detect("order-api", "Order.csproj", consumer, allRepos);

    // Should be deduped to one
    const authDeps = deps.filter((d) => d.detail.includes('"Contoso.Auth"'));
    expect(authDeps).toHaveLength(1);
  });

  // --- packages.config heuristic ---

  test("packages.config applies heuristic repo name matching", () => {
    const config = `<?xml version="1.0" encoding="utf-8"?>
    <packages>
      <package id="AuthService.Client" version="1.0.0" targetFramework="net48" />
      <package id="Newtonsoft.Json" version="13.0.3" targetFramework="net48" />
    </packages>`;
    const deps = detector.detect("order-api", "packages.config", config, allRepos);

    // "AuthService.Client" should heuristically match "auth-service"
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
    // "Newtonsoft.Json" should not match any repo
    expect(deps.every((d) => d.targetRepo !== "Newtonsoft.Json")).toBe(true);
  });
});
