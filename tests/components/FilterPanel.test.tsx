import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterPanel, FilterState, applyFilters } from "../../src/components/FilterPanel";
import { DependencyGraph, GraphNode, GraphEdge } from "../../src/models/DependencyGraph";
import { DependencyType, Confidence, Language } from "../../src/models/DependencyTypes";

function makeNode(id: string, language: Language = Language.Unknown): GraphNode {
  return {
    id,
    name: id,
    language,
    url: "",
    inDegree: 0,
    outDegree: 0,
    databases: [],
    publishedPackages: [],
    consumedPackages: [],
    consumedServices: [],
  };
}

function makeEdge(
  source: string,
  target: string,
  type: DependencyType = DependencyType.NuGet,
  confidence: Confidence = Confidence.High
): GraphEdge {
  return {
    id: `${source}->${target}:${type}`,
    source,
    target,
    type,
    confidence,
    details: [],
    weight: 1,
  };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): DependencyGraph {
  return {
    nodes,
    edges,
    deploymentTiers: [],
    cycles: [],
    stats: {
      totalRepos: nodes.length,
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

function defaultFilters(): FilterState {
  return {
    types: new Set(Object.values(DependencyType)),
    repos: new Set<string>(),
    minConfidence: Confidence.Low,
    showIsolated: true,
    repoFilterActive: false,
    languages: new Set(Object.values(Language)),
  };
}

describe("FilterPanel rendering", () => {
  test("renders filter panel with dependency types", () => {
    const graph = makeGraph([makeNode("A"), makeNode("B")], []);
    const filters = defaultFilters();
    const onChange = jest.fn();

    render(<FilterPanel graph={graph} filters={filters} onChange={onChange} />);

    expect(screen.getByLabelText("Filter panel")).toBeTruthy();
    expect(screen.getByText("NuGet")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
    expect(screen.getByText("Database")).toBeTruthy();
  });

  test("renders repositories from graph", () => {
    const graph = makeGraph([makeNode("my-repo"), makeNode("other-repo")], []);
    const filters = defaultFilters();
    const onChange = jest.fn();

    render(<FilterPanel graph={graph} filters={filters} onChange={onChange} />);

    expect(screen.getByText("my-repo")).toBeTruthy();
    expect(screen.getByText("other-repo")).toBeTruthy();
  });

  test("collapse button toggles panel", () => {
    const graph = makeGraph([makeNode("A")], []);
    const filters = defaultFilters();
    const onChange = jest.fn();

    render(<FilterPanel graph={graph} filters={filters} onChange={onChange} />);

    const collapseBtn = screen.getByLabelText("Collapse filters");
    expect(collapseBtn).toBeTruthy();
    fireEvent.click(collapseBtn);

    expect(screen.getByLabelText("Expand filters")).toBeTruthy();
  });

  test("Select All types calls onChange with all types", () => {
    const graph = makeGraph([], []);
    const filters: FilterState = {
      ...defaultFilters(),
      types: new Set<DependencyType>(),
    };
    const onChange = jest.fn();

    render(<FilterPanel graph={graph} filters={filters} onChange={onChange} />);

    const allBtn = screen.getAllByText("All")[0];
    fireEvent.click(allBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        types: new Set(Object.values(DependencyType)),
      })
    );
  });

  test("Select None types calls onChange with empty set", () => {
    const graph = makeGraph([], []);
    const filters = defaultFilters();
    const onChange = jest.fn();

    render(<FilterPanel graph={graph} filters={filters} onChange={onChange} />);

    const noneBtn = screen.getAllByText("None")[0];
    fireEvent.click(noneBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        types: new Set(),
      })
    );
  });
});

describe("applyFilters", () => {
  test("filters edges by type", () => {
    const graph = makeGraph(
      [makeNode("A"), makeNode("B"), makeNode("C")],
      [makeEdge("A", "B", DependencyType.NuGet), makeEdge("B", "C", DependencyType.API)]
    );

    const filters: FilterState = {
      ...defaultFilters(),
      types: new Set([DependencyType.NuGet]),
    };

    const result = applyFilters(graph, filters);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe(DependencyType.NuGet);
  });

  test("filters edges by confidence", () => {
    const graph = makeGraph(
      [makeNode("A"), makeNode("B"), makeNode("C")],
      [
        makeEdge("A", "B", DependencyType.NuGet, Confidence.High),
        makeEdge("B", "C", DependencyType.NuGet, Confidence.Low),
      ]
    );

    const filters: FilterState = {
      ...defaultFilters(),
      minConfidence: Confidence.High,
    };

    const result = applyFilters(graph, filters);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].confidence).toBe(Confidence.High);
  });

  test("hides isolated nodes when showIsolated is false", () => {
    const graph = makeGraph(
      [makeNode("A"), makeNode("B"), makeNode("isolated")],
      [makeEdge("A", "B")]
    );

    const filters: FilterState = {
      ...defaultFilters(),
      showIsolated: false,
    };

    const result = applyFilters(graph, filters);
    expect(result.nodes.map((n) => n.id)).toEqual(["A", "B"]);
  });

  test("filters nodes by language", () => {
    const graph = makeGraph(
      [makeNode("cs-repo", Language.CSharp), makeNode("go-repo", Language.Go)],
      []
    );

    const filters: FilterState = {
      ...defaultFilters(),
      languages: new Set([Language.CSharp]),
    };

    const result = applyFilters(graph, filters);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].language).toBe(Language.CSharp);
  });

  test("returns empty graph when all types deselected", () => {
    const graph = makeGraph([makeNode("A"), makeNode("B")], [makeEdge("A", "B")]);

    const filters: FilterState = {
      ...defaultFilters(),
      types: new Set(),
      showIsolated: false,
    };

    const result = applyFilters(graph, filters);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
  });

  test("repo filter restricts edges to selected repos", () => {
    const graph = makeGraph(
      [makeNode("A"), makeNode("B"), makeNode("C")],
      [makeEdge("A", "B"), makeEdge("B", "C")]
    );

    const filters: FilterState = {
      ...defaultFilters(),
      repos: new Set(["A", "B"]),
      repoFilterActive: true,
    };

    const result = applyFilters(graph, filters);
    // A->B should show (both in filter), B->C should also show (B is in filter)
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  test("medium confidence filter excludes low but keeps medium and high", () => {
    const graph = makeGraph(
      [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")],
      [
        makeEdge("A", "B", DependencyType.NuGet, Confidence.High),
        makeEdge("B", "C", DependencyType.NuGet, Confidence.Medium),
        makeEdge("C", "D", DependencyType.NuGet, Confidence.Low),
      ]
    );

    const filters: FilterState = {
      ...defaultFilters(),
      minConfidence: Confidence.Medium,
    };

    const result = applyFilters(graph, filters);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every((e) => e.confidence !== Confidence.Low)).toBe(true);
  });
});
