import { CycleGroup, GraphEdge } from "../models/DependencyGraph";
import { Confidence } from "../models/DependencyTypes";

// Iterative Tarjan's SCC algorithm — avoids stack overflow on large graphs
export function detectCycles(nodeIds: string[], edges: GraphEdge[]): CycleGroup[] {
  // Detect self-loops (single-node cycles)
  const selfLoops = new Set<string>();
  for (const edge of edges) {
    if (edge.source === edge.target) {
      selfLoops.add(edge.source);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  let index = 0;
  const sccStack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];

  // Iterative DFS using an explicit call stack
  interface Frame {
    node: string;
    neighbors: string[];
    neighborIdx: number;
  }

  function strongConnect(startNode: string) {
    const callStack: Frame[] = [];

    // Initialize start node
    indices.set(startNode, index);
    lowlinks.set(startNode, index);
    index++;
    sccStack.push(startNode);
    onStack.add(startNode);
    callStack.push({
      node: startNode,
      neighbors: adjacency.get(startNode) || [],
      neighborIdx: 0,
    });

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];

      if (frame.neighborIdx < frame.neighbors.length) {
        const w = frame.neighbors[frame.neighborIdx];
        frame.neighborIdx++;

        if (!indices.has(w)) {
          // Recurse: push new frame
          indices.set(w, index);
          lowlinks.set(w, index);
          index++;
          sccStack.push(w);
          onStack.add(w);
          callStack.push({
            node: w,
            neighbors: adjacency.get(w) || [],
            neighborIdx: 0,
          });
        } else if (onStack.has(w)) {
          lowlinks.set(frame.node, Math.min(lowlinks.get(frame.node)!, indices.get(w)!));
        }
      } else {
        // All neighbors processed — check if this is an SCC root
        if (lowlinks.get(frame.node) === indices.get(frame.node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = sccStack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.node);

          if (scc.length > 1) {
            sccs.push(scc);
          }
        }

        // Pop this frame and update parent's lowlink
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1];
          lowlinks.set(
            parent.node,
            Math.min(lowlinks.get(parent.node)!, lowlinks.get(frame.node)!)
          );
        }
      }
    }
  }

  for (const v of nodeIds) {
    if (!indices.has(v)) {
      strongConnect(v);
    }
  }

  const cycles: CycleGroup[] = sccs.map((repos) => {
    const repoSet = new Set(repos);
    const cycleEdges = edges.filter((e) => repoSet.has(e.source) && repoSet.has(e.target));
    return { repos, edges: cycleEdges };
  });

  // Add self-loop nodes as single-node cycles if not already part of a larger SCC
  const allSCCNodes = new Set<string>();
  for (const scc of sccs) {
    for (const nodeId of scc) {
      allSCCNodes.add(nodeId);
    }
  }
  for (const nodeId of selfLoops) {
    if (!allSCCNodes.has(nodeId)) {
      cycles.push({
        repos: [nodeId],
        edges: edges.filter((e) => e.source === nodeId && e.target === nodeId),
      });
    }
  }

  return cycles;
}

const CONFIDENCE_RANK: Record<string, number> = {
  [Confidence.Low]: 1,
  [Confidence.Medium]: 2,
  [Confidence.High]: 3,
};

/**
 * For each cycle, suggest which edge to break.
 * Prefers: lowest confidence, then lowest weight (fewest backing details).
 */
export function suggestCycleBreaks(cycles: CycleGroup[]): CycleGroup[] {
  return cycles.map((cycle) => {
    if (cycle.edges.length === 0) return cycle;

    const sorted = [...cycle.edges].sort((a, b) => {
      const confDiff = (CONFIDENCE_RANK[a.confidence] || 0) - (CONFIDENCE_RANK[b.confidence] || 0);
      if (confDiff !== 0) return confDiff;
      return a.weight - b.weight;
    });

    const weakest = sorted[0];
    return {
      ...cycle,
      breakSuggestion: {
        edge: weakest,
        reason: `Lowest confidence (${weakest.confidence}) with ${weakest.weight} backing detail(s)`,
      },
    };
  });
}
