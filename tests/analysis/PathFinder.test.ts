import { findAllPaths, findShortestPath } from "../../src/analysis/PathFinder";
import { DependencyGraph } from "../../src/models/DependencyGraph";
import { Language, DependencyType, Confidence } from "../../src/models/DependencyTypes";

function makeGraph(nodeIds: string[], edges: [string, string][]): DependencyGraph {
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
    edges: edges.map(([s, t]) => ({
      id: `${s}->${t}`,
      source: s,
      target: t,
      type: DependencyType.NuGet,
      confidence: Confidence.High,
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

describe("findAllPaths", () => {
  test("finds a direct path (A -> B)", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const paths = findAllPaths(graph, "A", "B");

    expect(paths).toEqual([["A", "B"]]);
  });

  test("finds multiple paths (A->B->D and A->C->D)", () => {
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["A", "C"],
        ["B", "D"],
        ["C", "D"],
      ]
    );
    const paths = findAllPaths(graph, "A", "D");

    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(["A", "B", "D"]);
    expect(paths).toContainEqual(["A", "C", "D"]);
  });

  test("returns empty array when no path exists", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B"]]);
    const paths = findAllPaths(graph, "A", "C");

    expect(paths).toEqual([]);
  });

  test("returns empty when source node doesn't exist", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const paths = findAllPaths(graph, "Z", "B");

    expect(paths).toEqual([]);
  });

  test("returns empty when target node doesn't exist", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const paths = findAllPaths(graph, "A", "Z");

    expect(paths).toEqual([]);
  });

  test("respects maxDepth limit", () => {
    // Build a chain A -> B -> C -> D -> E
    const graph = makeGraph(
      ["A", "B", "C", "D", "E"],
      [
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
        ["D", "E"],
      ]
    );

    // Path A->B->C->D->E has length 5 (5 node IDs in the path array).
    // maxDepth limits path.length, which starts at 1 ([sourceId]).
    // With maxDepth=3, we allow paths of up to 3 nodes, so A->B->C->D->E (5 nodes) is too long.
    const paths = findAllPaths(graph, "A", "E", 3);
    expect(paths).toEqual([]);

    // With default maxDepth (10), the path should be found.
    const pathsDefault = findAllPaths(graph, "A", "E");
    expect(pathsDefault).toEqual([["A", "B", "C", "D", "E"]]);
  });

  test("handles cycles without infinite loop", () => {
    // A -> B -> C -> A (cycle) and B -> D (exit)
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["B", "C"],
        ["C", "A"],
        ["B", "D"],
      ]
    );

    const paths = findAllPaths(graph, "A", "D");

    // Should find A -> B -> D and not loop infinitely through the cycle
    expect(paths).toEqual([["A", "B", "D"]]);
  });
});

describe("findShortestPath", () => {
  test("returns direct path for adjacent nodes", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const path = findShortestPath(graph, "A", "B");

    expect(path).toEqual(["A", "B"]);
  });

  test("returns shortest of multiple paths", () => {
    // A -> B -> C -> D (length 4) and A -> D (length 2, shortest)
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
        ["A", "D"],
      ]
    );
    const path = findShortestPath(graph, "A", "D");

    expect(path).toEqual(["A", "D"]);
  });

  test("returns null when no path exists", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B"]]);
    const path = findShortestPath(graph, "A", "C");

    expect(path).toBeNull();
  });

  test("returns [sourceId] when source equals target", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const path = findShortestPath(graph, "A", "A");

    expect(path).toEqual(["A"]);
  });

  test("returns null when source doesn't exist", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const path = findShortestPath(graph, "Z", "B");

    expect(path).toBeNull();
  });

  test("returns null when target doesn't exist", () => {
    const graph = makeGraph(["A", "B"], [["A", "B"]]);
    const path = findShortestPath(graph, "A", "Z");

    expect(path).toBeNull();
  });

  test("handles graph with no edges", () => {
    const graph = makeGraph(["A", "B"], []);
    const path = findShortestPath(graph, "A", "B");

    expect(path).toBeNull();
  });
});

describe("findAllPaths edge cases", () => {
  test("handles empty graph", () => {
    const graph = makeGraph([], []);
    const paths = findAllPaths(graph, "A", "B");
    expect(paths).toEqual([]);
  });

  test("respects maxResults limit", () => {
    // Diamond graph: A -> B -> D, A -> C -> D
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["A", "C"],
        ["B", "D"],
        ["C", "D"],
      ]
    );
    const paths = findAllPaths(graph, "A", "D", 10, 1);
    expect(paths).toHaveLength(1);
  });

  test("same source and target returns direct path", () => {
    const graph = makeGraph(["A"], []);
    const paths = findAllPaths(graph, "A", "A");
    expect(paths).toEqual([["A"]]);
  });

  test("handles disconnected components", () => {
    const graph = makeGraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["C", "D"],
      ]
    );
    const paths = findAllPaths(graph, "A", "D");
    expect(paths).toEqual([]);
  });
});
