import { DependencyDiffResult, DependencyGraph, GraphEdge } from "../models/DependencyGraph";

/**
 * Creates a composite key for matching edges by source, target, and type.
 */
function edgeKey(edge: GraphEdge): string {
  return `${edge.source}→${edge.target}:${edge.type}`;
}

/**
 * Compares two dependency graphs and returns the differences.
 * @param previous - The earlier graph snapshot
 * @param current - The newer graph snapshot
 * @returns A diff result describing added, removed, and changed edges and nodes
 */
export function diffGraphs(
  previous: DependencyGraph,
  current: DependencyGraph
): DependencyDiffResult {
  // Index previous edges by composite key
  const previousEdgeMap = new Map<string, GraphEdge>();
  for (const edge of previous.edges) {
    previousEdgeMap.set(edgeKey(edge), edge);
  }

  // Index current edges by composite key
  const currentEdgeMap = new Map<string, GraphEdge>();
  for (const edge of current.edges) {
    currentEdgeMap.set(edgeKey(edge), edge);
  }

  // Added edges: in current but not in previous
  const added: GraphEdge[] = [];
  // Changed edges: same key but different confidence
  const changed: Array<{ edge: GraphEdge; previousConfidence: GraphEdge["confidence"] }> = [];

  for (const [key, currentEdge] of currentEdgeMap) {
    const previousEdge = previousEdgeMap.get(key);
    if (!previousEdge) {
      added.push(currentEdge);
    } else if (previousEdge.confidence !== currentEdge.confidence) {
      changed.push({
        edge: currentEdge,
        previousConfidence: previousEdge.confidence,
      });
    }
  }

  // Removed edges: in previous but not in current
  const removed: GraphEdge[] = [];
  for (const [key, previousEdge] of previousEdgeMap) {
    if (!currentEdgeMap.has(key)) {
      removed.push(previousEdge);
    }
  }

  // Node diffs
  const previousNodeIds = new Set(previous.nodes.map((n) => n.id));
  const currentNodeIds = new Set(current.nodes.map((n) => n.id));

  const addedNodes: string[] = [];
  for (const id of currentNodeIds) {
    if (!previousNodeIds.has(id)) {
      addedNodes.push(id);
    }
  }

  const removedNodes: string[] = [];
  for (const id of previousNodeIds) {
    if (!currentNodeIds.has(id)) {
      removedNodes.push(id);
    }
  }

  return {
    added,
    removed,
    changed,
    addedNodes: addedNodes.sort(),
    removedNodes: removedNodes.sort(),
  };
}
