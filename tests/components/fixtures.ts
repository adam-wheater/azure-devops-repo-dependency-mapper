import { DependencyGraph, GraphEdge, GraphNode } from "../../src/models/DependencyGraph";
import { Confidence, DependencyType, Language } from "../../src/models/DependencyTypes";

export function makeNode(id: string, language: Language = Language.CSharp): GraphNode {
  return {
    id,
    name: id,
    language,
    url: `https://dev.azure.com/contoso/fabrikam/_git/${id}`,
    inDegree: 0,
    outDegree: 0,
    databases: [],
    publishedPackages: [],
    consumedPackages: [],
    consumedServices: [],
  };
}

export function makeEdge(
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

export function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): DependencyGraph {
  return {
    nodes,
    edges,
    deploymentTiers: [{ tier: 0, label: "Tier 0", repos: nodes.map((n) => n.id) }],
    cycles: [],
    stats: {
      totalRepos: nodes.length,
      totalEdges: edges.length,
      isolatedRepos: 0,
      maxDepth: 1,
      cycleCount: 0,
      scanDurationMs: 0,
      graphDensity: 0,
      avgDegree: 0,
      typeBreakdown: {},
    },
  };
}
