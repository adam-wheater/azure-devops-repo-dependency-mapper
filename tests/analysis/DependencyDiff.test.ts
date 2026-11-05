import { diffGraphs } from "../../src/analysis/DependencyDiff";
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

describe("DependencyDiff", () => {
  test("detects added edges", () => {
    const previous = makeGraph(["A", "B", "C"], [["A", "B"]]);
    const current = makeGraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );

    const diff = diffGraphs(previous, current);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].source).toBe("B");
    expect(diff.added[0].target).toBe("C");
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  test("detects removed edges", () => {
    const previous = makeGraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
    const current = makeGraph(["A", "B", "C"], [["A", "B"]]);

    const diff = diffGraphs(previous, current);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].source).toBe("B");
    expect(diff.removed[0].target).toBe("C");
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  test("detects changed confidence", () => {
    const previous = makeGraph(["A", "B"], [["A", "B", Confidence.Low]]);
    const current = makeGraph(["A", "B"], [["A", "B", Confidence.High]]);

    const diff = diffGraphs(previous, current);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].edge.source).toBe("A");
    expect(diff.changed[0].edge.target).toBe("B");
    expect(diff.changed[0].edge.confidence).toBe(Confidence.High);
    expect(diff.changed[0].previousConfidence).toBe(Confidence.Low);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  test("detects added nodes", () => {
    const previous = makeGraph(["A", "B"], [["A", "B"]]);
    const current = makeGraph(["A", "B", "C", "D"], [["A", "B"]]);

    const diff = diffGraphs(previous, current);

    expect(diff.addedNodes).toEqual(["C", "D"]);
    expect(diff.removedNodes).toEqual([]);
  });

  test("detects removed nodes", () => {
    const previous = makeGraph(["A", "B", "C"], [["A", "B"]]);
    const current = makeGraph(["A"], []);

    const diff = diffGraphs(previous, current);

    expect(diff.removedNodes).toEqual(["B", "C"]);
    expect(diff.addedNodes).toEqual([]);
  });

  test("returns empty diff for identical graphs", () => {
    const graphA = makeGraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
    const graphB = makeGraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );

    const diff = diffGraphs(graphA, graphB);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
  });

  test("handles empty graphs", () => {
    const empty1 = makeGraph([], []);
    const empty2 = makeGraph([], []);

    const diff = diffGraphs(empty1, empty2);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
  });
});
