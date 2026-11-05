import { DependencyGraph, GraphEdge } from "../models/DependencyGraph";

export interface ImpactResult {
  directDependents: string[];
  transitiveDependents: string[];
  blastRadius: number;
  affectedTiers: number[];
  criticalPath: string[];
}

/**
 * Analyzes the downstream impact of a given repository by walking inbound edges
 * transitively to find everything that depends on this repo.
 * @param graph - The dependency graph to analyze
 * @param repoId - The repository ID to assess impact for
 * @returns Impact analysis result including direct/transitive dependents and blast radius
 */
export function analyzeImpact(graph: DependencyGraph, repoId: string): ImpactResult {
  const nodeExists = graph.nodes.some((n) => n.id === repoId);
  if (!nodeExists) {
    return {
      directDependents: [],
      transitiveDependents: [],
      blastRadius: 0,
      affectedTiers: [],
      criticalPath: [],
    };
  }

  // Build reverse adjacency: for each node, which nodes depend on it (have edges pointing TO it)
  const reverseAdjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    reverseAdjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    // edge.source depends on edge.target, so edge.source is a dependent of edge.target
    reverseAdjacency.get(edge.target)?.push(edge.source);
  }

  // Find direct dependents: repos that have an edge pointing to repoId
  const directDependents = new Set<string>(reverseAdjacency.get(repoId) || []);

  // BFS from repoId along reverse edges to find all transitive dependents
  const allDependents = new Set<string>();
  const visited = new Set<string>([repoId]);
  const queue: string[] = [repoId];
  let queueIdx = 0;

  while (queueIdx < queue.length) {
    const current = queue[queueIdx++];

    for (const dependent of reverseAdjacency.get(current) || []) {
      if (visited.has(dependent)) continue;

      visited.add(dependent);
      allDependents.add(dependent);
      queue.push(dependent);
    }
  }

  // Transitive dependents are those not in the direct set
  const transitiveDependents = new Set<string>();
  for (const dep of allDependents) {
    if (!directDependents.has(dep)) {
      transitiveDependents.add(dep);
    }
  }

  // Find affected tiers
  const affectedTierSet = new Set<number>();
  for (const tier of graph.deploymentTiers) {
    for (const repo of tier.repos) {
      if (allDependents.has(repo)) {
        affectedTierSet.add(tier.tier);
        break;
      }
    }
  }

  // Find critical path: the longest chain from repoId through dependents (reverse edges)
  const criticalPath = findLongestChainReverse(repoId, graph.edges);

  return {
    directDependents: [...directDependents].sort(),
    transitiveDependents: [...transitiveDependents].sort(),
    blastRadius: allDependents.size,
    affectedTiers: [...affectedTierSet].sort((a, b) => a - b),
    criticalPath,
  };
}

/**
 * Iterative DFS to find the longest chain from a start node.
 * Uses an explicit stack to avoid call stack overflow on large graphs.
 */
function findLongestChainIterative(startId: string, adjacency: Map<string, string[]>): string[] {
  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();

  interface Frame {
    nodeId: string;
    neighbors: string[];
    idx: number;
    longestSuffix: string[];
  }

  const stack: Frame[] = [];
  stack.push({
    nodeId: startId,
    neighbors: adjacency.get(startId) || [],
    idx: 0,
    longestSuffix: [],
  });
  visiting.add(startId);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.idx < frame.neighbors.length) {
      const neighbor = frame.neighbors[frame.idx];
      frame.idx++;

      if (memo.has(neighbor)) {
        const path = memo.get(neighbor)!;
        if (path.length > frame.longestSuffix.length) {
          frame.longestSuffix = path;
        }
      } else if (!visiting.has(neighbor)) {
        visiting.add(neighbor);
        stack.push({
          nodeId: neighbor,
          neighbors: adjacency.get(neighbor) || [],
          idx: 0,
          longestSuffix: [],
        });
      }
      // If visiting.has(neighbor) — cycle, skip
    } else {
      // All neighbors processed
      stack.pop();
      visiting.delete(frame.nodeId);
      const result = [frame.nodeId, ...frame.longestSuffix];
      memo.set(frame.nodeId, result);

      // Update parent frame
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (result.length > parent.longestSuffix.length) {
          parent.longestSuffix = result;
        }
      }
    }
  }

  return memo.get(startId) || [startId];
}

/**
 * Finds the longest chain from the given start node following reverse edges
 * (walking through dependents).
 */
function findLongestChainReverse(startId: string, edges: GraphEdge[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.target)!.push(edge.source);
  }
  return findLongestChainIterative(startId, adjacency);
}
