import { buildGraph } from "../../src/analysis/GraphBuilder";
import { ScanResult, RepoMetadata } from "../../src/scanning/ScanOrchestrator";
import {
  DetectedDependency,
  DependencyType,
  Confidence,
  Language,
} from "../../src/models/DependencyTypes";

function makeDep(
  source: string,
  target: string,
  type: DependencyType = DependencyType.NuGet,
  confidence: Confidence = Confidence.High,
  detail: string = "test dep"
): DetectedDependency {
  return {
    sourceRepo: source,
    targetRepo: target,
    type,
    confidence,
    detail,
    sourceFile: "test.csproj",
  };
}

function makeScanResult(
  deps: DetectedDependency[],
  repoLanguages?: Map<string, Language>,
  repoUrls?: Map<string, string>,
  repoMetadata?: Map<string, RepoMetadata>
): ScanResult {
  return {
    dependencies: deps,
    repoLanguages: repoLanguages || new Map(),
    repoUrls: repoUrls || new Map(),
    infraResources: [],
    allRepoNames: [],
    repoMetadata: repoMetadata || new Map(),
  };
}

describe("GraphBuilder", () => {
  test("creates nodes for all repo names with correct defaults", () => {
    const graph = buildGraph(makeScanResult([]), ["A", "B", "C"]);

    expect(graph.nodes).toHaveLength(3);
    for (const node of graph.nodes) {
      expect(node.inDegree).toBe(0);
      expect(node.outDegree).toBe(0);
      expect(node.language).toBe(Language.Unknown);
      expect(node.url).toBe("");
    }
  });

  test("assigns language and URL from scan result maps", () => {
    const langs = new Map<string, Language>([["A", Language.CSharp]]);
    const urls = new Map<string, string>([["A", "https://dev.azure.com/org/project/_git/A"]]);
    const graph = buildGraph(makeScanResult([], langs, urls), ["A", "B"]);

    const nodeA = graph.nodes.find((n) => n.id === "A")!;
    expect(nodeA.language).toBe(Language.CSharp);
    expect(nodeA.url).toBe("https://dev.azure.com/org/project/_git/A");

    const nodeB = graph.nodes.find((n) => n.id === "B")!;
    expect(nodeB.language).toBe(Language.Unknown);
    expect(nodeB.url).toBe("");
  });

  test("aggregates multiple dependencies into a single edge with weight", () => {
    const deps = [
      makeDep("A", "B", DependencyType.NuGet, Confidence.High, "dep 1"),
      makeDep("A", "B", DependencyType.NuGet, Confidence.Medium, "dep 2"),
      makeDep("A", "B", DependencyType.NuGet, Confidence.Low, "dep 3"),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B"]);

    const abEdges = graph.edges.filter((e) => e.source === "A" && e.target === "B");
    expect(abEdges).toHaveLength(1);
    expect(abEdges[0].weight).toBe(3);
    expect(abEdges[0].details).toHaveLength(3);
  });

  test("creates separate edges for different dependency types", () => {
    const deps = [makeDep("A", "B", DependencyType.NuGet), makeDep("A", "B", DependencyType.API)];
    const graph = buildGraph(makeScanResult(deps), ["A", "B"]);

    const abEdges = graph.edges.filter((e) => e.source === "A" && e.target === "B");
    expect(abEdges).toHaveLength(2);
    const types = abEdges.map((e) => e.type).sort();
    expect(types).toEqual([DependencyType.API, DependencyType.NuGet]);
  });

  test("calculates in-degree and out-degree correctly", () => {
    const deps = [
      makeDep("A", "B", DependencyType.NuGet),
      makeDep("A", "C", DependencyType.API),
      makeDep("D", "B", DependencyType.NuGet),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B", "C", "D"]);

    const find = (id: string) => graph.nodes.find((n) => n.id === id)!;
    expect(find("A").outDegree).toBe(2);
    expect(find("A").inDegree).toBe(0);
    expect(find("B").inDegree).toBe(2);
    expect(find("B").outDegree).toBe(0);
    expect(find("C").inDegree).toBe(1);
    expect(find("C").outDegree).toBe(0);
    expect(find("D").outDegree).toBe(1);
    expect(find("D").inDegree).toBe(0);
  });

  test("selects best confidence for aggregated edge", () => {
    const deps = [
      makeDep("A", "B", DependencyType.NuGet, Confidence.Low, "low"),
      makeDep("A", "B", DependencyType.NuGet, Confidence.Medium, "med"),
      makeDep("A", "B", DependencyType.NuGet, Confidence.High, "high"),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B"]);
    expect(graph.edges[0].confidence).toBe(Confidence.High);

    // Medium wins when no High
    const deps2 = [
      makeDep("A", "B", DependencyType.NuGet, Confidence.Low, "low"),
      makeDep("A", "B", DependencyType.NuGet, Confidence.Medium, "med"),
    ];
    const graph2 = buildGraph(makeScanResult(deps2), ["A", "B"]);
    expect(graph2.edges[0].confidence).toBe(Confidence.Medium);
  });

  test("skips dependencies referencing repos not in allRepoNames", () => {
    const deps = [makeDep("A", "unknown-repo", DependencyType.NuGet)];
    const graph = buildGraph(makeScanResult(deps), ["A", "B"]);
    expect(graph.edges).toHaveLength(0);
  });

  test("computes stats with isolated repos and cycle count", () => {
    const deps = [
      makeDep("A", "B", DependencyType.NuGet),
      makeDep("B", "A", DependencyType.NuGet),
      makeDep("C", "D", DependencyType.API),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B", "C", "D", "E"]);

    expect(graph.stats.totalRepos).toBe(5);
    expect(graph.stats.totalEdges).toBe(3);
    expect(graph.stats.isolatedRepos).toBe(1); // E is isolated
    expect(graph.stats.cycleCount).toBe(1); // A <-> B
    expect(graph.stats.maxDepth).toBeGreaterThan(0);
  });

  test("populates node metadata from repoMetadata", () => {
    const meta = new Map<string, RepoMetadata>([
      [
        "A",
        {
          databases: ["OrdersDB", "CustomersDB"],
          publishedPackages: ["contoso.shared.models"],
          consumedServices: [
            { serviceType: "Redis", instanceId: "prod-redis", detectedFrom: "appsettings" },
            { serviceType: "Key Vault", instanceId: "prod-vault", detectedFrom: "appsettings" },
          ],
        },
      ],
      [
        "B",
        {
          databases: [],
          publishedPackages: [],
          consumedServices: [],
        },
      ],
    ]);

    const graph = buildGraph(makeScanResult([], undefined, undefined, meta), ["A", "B"]);

    const nodeA = graph.nodes.find((n) => n.id === "A")!;
    expect(nodeA.databases).toEqual(["OrdersDB", "CustomersDB"]);
    expect(nodeA.publishedPackages).toEqual(["contoso.shared.models"]);
    expect(nodeA.consumedServices).toHaveLength(2);
    expect(nodeA.consumedServices[0].serviceType).toBe("Redis");
    expect(nodeA.consumedServices[1].instanceId).toBe("prod-vault");

    const nodeB = graph.nodes.find((n) => n.id === "B")!;
    expect(nodeB.databases).toEqual([]);
    expect(nodeB.consumedServices).toEqual([]);
  });

  test("handles missing repoMetadata gracefully", () => {
    const graph = buildGraph(makeScanResult([]), ["A", "B"]);
    const nodeA = graph.nodes.find((n) => n.id === "A")!;
    expect(nodeA.databases).toEqual([]);
    expect(nodeA.publishedPackages).toEqual([]);
    expect(nodeA.consumedPackages).toEqual([]);
    expect(nodeA.consumedServices).toEqual([]);
  });

  test("populates consumedPackages from NuGet dependency details", () => {
    const deps = [
      makeDep(
        "A",
        "B",
        DependencyType.NuGet,
        Confidence.High,
        'PackageReference "Contoso.Auth.Client" published by B'
      ),
      makeDep(
        "A",
        "C",
        DependencyType.NuGet,
        Confidence.Medium,
        'PackageReference "Contoso.Shared.Models" matches repo "C"'
      ),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B", "C"]);

    const nodeA = graph.nodes.find((n) => n.id === "A")!;
    expect(nodeA.consumedPackages).toContain("Contoso.Auth.Client");
    expect(nodeA.consumedPackages).toContain("Contoso.Shared.Models");
  });

  test("filters out self-loop edges", () => {
    const deps = [
      makeDep("A", "A", DependencyType.NuGet, Confidence.High, "self dep"),
      makeDep("A", "B", DependencyType.NuGet, Confidence.High, "real dep"),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B"]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source).toBe("A");
    expect(graph.edges[0].target).toBe("B");
  });

  test("empty graph with no repos produces empty result", () => {
    const graph = buildGraph(makeScanResult([]), []);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.deploymentTiers).toHaveLength(0);
    expect(graph.cycles).toHaveLength(0);
    expect(graph.stats.totalRepos).toBe(0);
    expect(graph.stats.totalEdges).toBe(0);
    expect(graph.stats.isolatedRepos).toBe(0);
    expect(graph.stats.graphDensity).toBe(0);
    expect(graph.stats.avgDegree).toBe(0);
  });

  test("single node graph with no edges", () => {
    const graph = buildGraph(makeScanResult([]), ["A"]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.stats.totalRepos).toBe(1);
    expect(graph.stats.isolatedRepos).toBe(1);
    expect(graph.stats.cycleCount).toBe(0);
  });

  test("all-cycle graph: every node in a single cycle", () => {
    const deps = [
      makeDep("A", "B", DependencyType.NuGet),
      makeDep("B", "C", DependencyType.NuGet),
      makeDep("C", "A", DependencyType.NuGet),
    ];
    const graph = buildGraph(makeScanResult(deps), ["A", "B", "C"]);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
    expect(graph.stats.cycleCount).toBe(1);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0].repos.sort()).toEqual(["A", "B", "C"]);
    expect(graph.stats.isolatedRepos).toBe(0);
  });
});
