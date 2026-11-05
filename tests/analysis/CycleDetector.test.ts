import { detectCycles } from "../../src/analysis/CycleDetector";
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

describe("CycleDetector", () => {
  test("no cycles in a DAG", () => {
    const nodes = ["A", "B", "C"];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C")];

    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(0);
  });

  test("detects simple cycle A→B→A", () => {
    const nodes = ["A", "B"];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A")];

    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].repos.sort()).toEqual(["A", "B"]);
  });

  test("detects 3-node cycle", () => {
    const nodes = ["A", "B", "C"];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")];

    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].repos.sort()).toEqual(["A", "B", "C"]);
  });

  test("detects multiple SCCs", () => {
    const nodes = ["A", "B", "C", "D", "E"];
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "A"), // cycle 1: A↔B
      makeEdge("C", "D"),
      makeEdge("D", "E"),
      makeEdge("E", "C"), // cycle 2: C→D→E→C
      makeEdge("B", "C"), // bridge (not a cycle)
    ];

    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(2);

    const sizes = cycles.map((c) => c.repos.length).sort();
    expect(sizes).toEqual([2, 3]);
  });

  test("isolated nodes are not cycles", () => {
    const nodes = ["A", "B", "C"];
    const edges: GraphEdge[] = [];

    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(0);
  });

  test("self-loop is detected as a single-node cycle", () => {
    // Self-loops are now detected as single-node cycles
    const nodes = ["A"];
    const edges = [makeEdge("A", "A")];

    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].repos).toEqual(["A"]);
    expect(cycles[0].edges).toHaveLength(1);
    expect(cycles[0].edges[0].source).toBe("A");
    expect(cycles[0].edges[0].target).toBe("A");
  });
});
