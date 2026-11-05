import { DeploymentTier, GraphEdge } from "../models/DependencyGraph";

// Kahn's algorithm — produces deployment tiers
export function topologicalSort(nodeIds: string[], edges: GraphEdge[]): DeploymentTier[] {
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) inDegree.set(id, 0);

  // Build adjacency and compute in-degree (deduplicated)
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    if (!adjacency.get(edge.source)!.has(edge.target)) {
      adjacency.get(edge.source)!.add(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  const tiers: DeploymentTier[] = [];
  const remaining = new Set(nodeIds);

  while (remaining.size > 0) {
    // Find all nodes with in-degree 0 (among remaining)
    const tierNodes: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) || 0) === 0) {
        tierNodes.push(id);
      }
    }

    // If no nodes have in-degree 0, we have a cycle — put remaining in last tier
    if (tierNodes.length === 0) {
      tiers.push({
        tier: tiers.length,
        label: `Tier ${tiers.length} (Circular Dependencies)`,
        repos: [...remaining].sort(),
      });
      break;
    }

    const tierIndex = tiers.length;
    const label = tierIndex === 0 ? "Tier 0 - Deploy First (no dependencies)" : `Tier ${tierIndex}`;

    tiers.push({
      tier: tierIndex,
      label,
      repos: tierNodes.sort(),
    });

    // Remove tier nodes and update in-degrees
    for (const node of tierNodes) {
      remaining.delete(node);
      for (const neighbor of adjacency.get(node) || []) {
        if (remaining.has(neighbor)) {
          inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
        }
      }
    }
  }

  // Label last tier (only if there are multiple tiers — avoid overwriting "Deploy First")
  if (tiers.length > 1) {
    const lastTier = tiers[tiers.length - 1];
    if (!lastTier.label.includes("Circular")) {
      lastTier.label = `Tier ${lastTier.tier} - Deploy Last`;
    }
  }

  return tiers;
}
