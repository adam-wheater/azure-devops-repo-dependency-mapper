import { analyzeImpact } from "../../src/analysis/ImpactAnalysis";
import { DependencyGraph } from "../../src/models/DependencyGraph";
import { Language, DependencyType, Confidence } from "../../src/models/DependencyTypes";

function makeGraph(nodeIds: string[], edges: [string, string, Confidence?][]): DependencyGraph {
  return {
    nodes: nodeIds.map((id) => ({
      id,
      name: id,
      language: Language.Unknown,
      url: "",
      inDegree: 0,
      outDegree: 0,
      databases: [],
      publishedPackages: [],
      consumedPackages: [],
      consumedServices: [],
    })),
    edges: edges.map(([s, t, conf]) => ({
      id: `${s}->${t}:nuget`,
      source: s,
      target: t,
      type: DependencyType.NuGet,
      confidence: conf || Confidence.High,
      details: [],
      weight: 1,
    })),
    deploymentTiers: [],
    cycles: [],
    stats: {
      totalRepos: nodeIds.length,
      totalEdges: edges.length,
      isolatedRepos: 0,
      maxDepth: 0,
      cycleCount: 0,
      scanDurationMs: 0,
      graphDensity: 0,
      avgDegree: 0,
      typeBreakdown: {},
    },
  };
}

describe("ImpactAnalysis", () => {
  test("direct dependents identified correctly", () => {
    // A -> C, B -> C  =>  A and B are direct dependents of C
    const graph = makeGraph(
      ["A", "B", "C"],
      [
        ["A", "C"],
        ["B", "C"],
      ]
    );

    const result = analyzeImpact(graph, "C");

    expect(result.directDependents).toEqual(["A", "B"]);
  });

  test("transitive dependents found via BFS", () => {
    // D -> C -> B -> A  =>  for A: direct dependent is B, transitive are C and D
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["B", "A"],
        ["C", "B"],
        ["D", "C"],
      ]
    );

    const result = analyzeImpact(graph, "A");

    expect(result.directDependents).toEqual(["B"]);
    expect(result.transitiveDependents.sort()).toEqual(["C", "D"]);
  });

  test("blast radius is total unique impacted repos", () => {
    // A is depended on by B, C; B is depended on by D
    // blast radius of A = 3  (B, C, D)
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["B", "A"],
        ["C", "A"],
        ["D", "B"],
      ]
    );

    const result = analyzeImpact(graph, "A");

    expect(result.blastRadius).toBe(3);
  });

  test("affected tiers computed from deployment tiers", () => {
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["B", "A"],
        ["C", "B"],
        ["D", "C"],
      ]
    );
    graph.deploymentTiers = [
      { tier: 0, label: "Tier 0", repos: ["A"] },
      { tier: 1, label: "Tier 1", repos: ["B"] },
      { tier: 2, label: "Tier 2", repos: ["C", "D"] },
    ];

    const result = analyzeImpact(graph, "A");

    // B is in tier 1, C and D are in tier 2 — all are dependents of A
    expect(result.affectedTiers).toEqual([1, 2]);
  });

  test("critical path is the longest chain", () => {
    // Chain: E -> D -> C -> B -> A   (longest path from A through dependents)
    // Also: F -> A  (shorter branch)
    const graph = makeGraph(
      ["A", "B", "C", "D", "E", "F"],
      [
        ["B", "A"],
        ["C", "B"],
        ["D", "C"],
        ["E", "D"],
        ["F", "A"],
      ]
    );

    const result = analyzeImpact(graph, "A");

    expect(result.criticalPath).toEqual(["A", "B", "C", "D", "E"]);
  });

  test("returns empty results for isolated node", () => {
    const graph = makeGraph(["A", "B", "C"], [["B", "C"]]);

    const result = analyzeImpact(graph, "A");

    expect(result.directDependents).toEqual([]);
    expect(result.transitiveDependents).toEqual([]);
    expect(result.blastRadius).toBe(0);
    expect(result.affectedTiers).toEqual([]);
    expect(result.criticalPath).toEqual(["A"]);
  });

  test("handles node with no dependents", () => {
    // A -> B -> C   =>  A depends on B which depends on C
    // A has no dependents (nothing points to A via reverse edges)
    const graph = makeGraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );

    const result = analyzeImpact(graph, "A");

    expect(result.directDependents).toEqual([]);
    expect(result.transitiveDependents).toEqual([]);
    expect(result.blastRadius).toBe(0);
    expect(result.criticalPath).toEqual(["A"]);
  });
});
