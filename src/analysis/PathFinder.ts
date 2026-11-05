import { DependencyGraph, GraphEdge } from "../models/DependencyGraph";

function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }
  return adj;
}

/**
 * Finds all directed paths from source to target using DFS with cycle detection.
 * @param graph - The dependency graph to search
 * @param sourceId - Starting node ID
 * @param targetId - Destination node ID
 * @param maxDepth - Maximum path length (defaults to 10)
 * @param maxResults - Maximum number of paths to return (defaults to 1000)
 * @returns Array of paths, where each path is an array of node IDs
 */
export function findAllPaths(
  graph: DependencyGraph,
  sourceId: string,
  targetId: string,
  maxDepth: number = 10,
  maxResults: number = 1000
): string[][] {
  const adjacency = buildAdjacency(graph.edges);
  for (const node of graph.nodes) {
    if (!adjacency.has(node.id)) adjacency.set(node.id, []);
  }

  // Verify both nodes exist
  if (!adjacency.has(sourceId) || !adjacency.has(targetId)) {
    return [];
  }

  const results: string[][] = [];
  const visited = new Set<string>();

  function dfs(current: string, path: string[]): void {
    if (results.length >= maxResults) return;
    if (path.length > maxDepth) return;

    if (current === targetId) {
      results.push([...path]);
      return;
    }

    visited.add(current);

    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) {
        path.push(neighbor);
        dfs(neighbor, path);
        path.pop();
      }
    }

    visited.delete(current);
  }

  dfs(sourceId, [sourceId]);

  return results;
}

/**
 * Finds the shortest directed path from source to target using BFS.
 * @param graph - The dependency graph to search
 * @param sourceId - Starting node ID
 * @param targetId - Destination node ID
 * @returns Array of node IDs representing the shortest path, or null if no path exists
 */
export function findShortestPath(
  graph: DependencyGraph,
  sourceId: string,
  targetId: string
): string[] | null {
  const adjacency = buildAdjacency(graph.edges);
  for (const node of graph.nodes) {
    if (!adjacency.has(node.id)) adjacency.set(node.id, []);
  }

  // Verify both nodes exist
  if (!adjacency.has(sourceId) || !adjacency.has(targetId)) {
    return null;
  }

  if (sourceId === targetId) {
    return [sourceId];
  }

  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, string>();
  const queue: string[] = [sourceId];
  let queueIdx = 0;

  while (queueIdx < queue.length) {
    const current = queue[queueIdx++];

    for (const neighbor of adjacency.get(current) || []) {
      if (visited.has(neighbor)) continue;

      parent.set(neighbor, current);

      if (neighbor === targetId) {
        // Reconstruct path
        const path: string[] = [targetId];
        let node = targetId;
        while (node !== sourceId) {
          node = parent.get(node)!;
          path.unshift(node);
        }
        return path;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return null;
}
