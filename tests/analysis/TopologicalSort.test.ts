import { topologicalSort } from "../../src/analysis/TopologicalSort";
import { GraphEdge } from "../../src/models/DependencyGraph";
import { Confidence, DependencyType } from "../../src/models/DependencyTypes";

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}→${target}`,
    source,
    target,
    type: DependencyType.NuGet,
    confidence: Confidence.High,
    details: [],
    weight: 1,
  };
}

describe("TopologicalSort", () => {
  test("simple DAG produces correct tiers", () => {
    const nodes = ["A", "B", "C", "D"];
    const edges = [makeEdge("A", "B"), makeEdge("A", "C"), makeEdge("B", "D")];

    const tiers = topologicalSort(nodes, edges);

    // C and D have no outgoing deps, but:
    // Tier 0 should contain nodes with no incoming edges
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    expect(tiers[0].repos).toContain("A");
    // D should be in a later tier than B
    const tierOfB = tiers.findIndex((t) => t.repos.includes("B"));
    const tierOfD = tiers.findIndex((t) => t.repos.includes("D"));
    expect(tierOfB).toBeLessThan(tierOfD);
  });

  test("isolated nodes go in tier 0", () => {
    const nodes = ["A", "B", "C"];
    const edges: GraphEdge[] = [];

    const tiers = topologicalSort(nodes, edges);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].repos.sort()).toEqual(["A", "B", "C"]);
  });

  test("linear chain produces one node per tier", () => {
    const nodes = ["A", "B", "C"];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C")];

    const tiers = topologicalSort(nodes, edges);
    expect(tiers).toHaveLength(3);
    expect(tiers[0].repos).toEqual(["A"]);
    expect(tiers[1].repos).toEqual(["B"]);
    expect(tiers[2].repos).toEqual(["C"]);
  });

  test("handles cycles by grouping remaining in last tier", () => {
    const nodes = ["A", "B", "C"];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")];

    const tiers = topologicalSort(nodes, edges);
    // All nodes are in a cycle so no node has in-degree 0 initially?
    // Actually all have in-degree 1, so tier 0 will be empty → cycle group
    expect(tiers.length).toBeGreaterThanOrEqual(1);
    const lastTier = tiers[tiers.length - 1];
    expect(lastTier.label).toContain("Circular");
  });

  test("parallel branches are in same tier", () => {
    const nodes = ["root", "branchA", "branchB", "leaf"];
    const edges = [
      makeEdge("root", "branchA"),
      makeEdge("root", "branchB"),
      makeEdge("branchA", "leaf"),
      makeEdge("branchB", "leaf"),
    ];

    const tiers = topologicalSort(nodes, edges);
    expect(tiers).toHaveLength(3);
    expect(tiers[1].repos.sort()).toEqual(["branchA", "branchB"]);
  });
});
