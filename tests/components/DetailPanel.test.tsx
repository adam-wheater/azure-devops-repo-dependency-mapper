import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailPanel } from "../../src/components/DetailPanel";
import { DependencyGraph, GraphNode, GraphEdge } from "../../src/models/DependencyGraph";
import { DependencyType, Confidence, Language } from "../../src/models/DependencyTypes";

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id,
    language: Language.CSharp,
    url: "https://dev.azure.com/org/project/_git/" + id,
    inDegree: 0,
    outDegree: 0,
    databases: [],
    publishedPackages: [],
    consumedPackages: [],
    consumedServices: [],
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  type: DependencyType = DependencyType.NuGet
): GraphEdge {
  return {
    id: `${source}->${target}:${type}`,
    source,
    target,
    type,
    confidence: Confidence.High,
    details: [
      {
        description: `${source} depends on ${target}`,
        sourceFile: "test.cs",
        type,
        confidence: Confidence.High,
      },
    ],
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

describe("DetailPanel", () => {
  test("shows placeholder when nothing selected", () => {
    render(
      <DetailPanel
        selectedNode={null}
        selectedEdge={null}
        infraResources={[]}
        allEdges={[]}
        onPinToggle={jest.fn()}
        pinnedNodes={new Set()}
        graph={null}
        onNodeClick={jest.fn()}
      />
    );

    expect(screen.getByText("Click a node or edge to view details")).toBeTruthy();
  });

  test("displays selected node details", () => {
    const node = makeNode("my-service", {
      inDegree: 2,
      outDegree: 3,
      databases: ["OrdersDB"],
      publishedPackages: ["My.Package"],
    });

    render(
      <DetailPanel
        selectedNode={node}
        selectedEdge={null}
        infraResources={[]}
        allEdges={[]}
        onPinToggle={jest.fn()}
        pinnedNodes={new Set()}
        graph={makeGraph([node], [])}
        onNodeClick={jest.fn()}
      />
    );

    expect(screen.getByText("my-service")).toBeTruthy();
    expect(screen.getByText("Open in Azure DevOps")).toBeTruthy();
    expect(screen.getByText("OrdersDB")).toBeTruthy();
    expect(screen.getByText("My.Package")).toBeTruthy();
  });

  test("displays selected edge details", () => {
    const edge = makeEdge("repo-a", "repo-b");

    render(
      <DetailPanel
        selectedNode={null}
        selectedEdge={edge}
        infraResources={[]}
        allEdges={[edge]}
        onPinToggle={jest.fn()}
        pinnedNodes={new Set()}
        graph={null}
        onNodeClick={jest.fn()}
      />
    );

    expect(screen.getAllByText(/repo-a.*repo-b/).length).toBeGreaterThan(0);
    expect(screen.getByText("repo-a depends on repo-b")).toBeTruthy();
  });

  test("dependency lists are clickable", () => {
    const nodeA = makeNode("repo-a", { outDegree: 1 });
    const nodeB = makeNode("repo-b", { inDegree: 1 });
    const edge = makeEdge("repo-a", "repo-b");
    const graph = makeGraph([nodeA, nodeB], [edge]);
    const onNodeClick = jest.fn();

    render(
      <DetailPanel
        selectedNode={nodeA}
        selectedEdge={null}
        infraResources={[]}
        allEdges={[edge]}
        onPinToggle={jest.fn()}
        pinnedNodes={new Set()}
        graph={graph}
        onNodeClick={onNodeClick}
      />
    );

    // The "Depends On" section should show repo-b as a clickable link
    const repoLink = screen.getByTitle("Select repo-b");
    expect(repoLink).toBeTruthy();
    fireEvent.click(repoLink);
    expect(onNodeClick).toHaveBeenCalledWith(nodeB);
  });

  test("pin button toggles pin state", () => {
    const node = makeNode("pinnable-node");
    const onPinToggle = jest.fn();

    render(
      <DetailPanel
        selectedNode={node}
        selectedEdge={null}
        infraResources={[]}
        allEdges={[]}
        onPinToggle={onPinToggle}
        pinnedNodes={new Set()}
        graph={makeGraph([node], [])}
        onNodeClick={jest.fn()}
      />
    );

    const pinButton = screen.getByTitle("Pin node position");
    fireEvent.click(pinButton);
    expect(onPinToggle).toHaveBeenCalledWith("pinnable-node");
  });

  test("impact analysis button works", () => {
    const nodeA = makeNode("repo-a", { outDegree: 1 });
    const nodeB = makeNode("repo-b", { inDegree: 1 });
    const edge = makeEdge("repo-a", "repo-b");
    const graph = makeGraph([nodeA, nodeB], [edge]);

    render(
      <DetailPanel
        selectedNode={nodeB}
        selectedEdge={null}
        infraResources={[]}
        allEdges={[edge]}
        onPinToggle={jest.fn()}
        pinnedNodes={new Set()}
        graph={graph}
        onNodeClick={jest.fn()}
      />
    );

    const analyzeBtn = screen.getByText("Analyze Impact");
    fireEvent.click(analyzeBtn);

    expect(screen.getByText(/Blast radius/)).toBeTruthy();
  });
});
