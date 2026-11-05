import {
  DependencyGraph,
  GraphEdge,
  GraphNode,
  GraphStats,
  EdgeDetail,
} from "../models/DependencyGraph";
import { DependencyType, Language } from "../models/DependencyTypes";
import { Confidence } from "../models/DependencyTypes";
import { ScanResult } from "../scanning/ScanOrchestrator";
import { detectCycles, suggestCycleBreaks } from "./CycleDetector";
import { topologicalSort } from "./TopologicalSort";

function bestConfidence(details: EdgeDetail[]): Confidence {
  if (details.some((d) => d.confidence === Confidence.High)) return Confidence.High;
  if (details.some((d) => d.confidence === Confidence.Medium)) return Confidence.Medium;
  return Confidence.Low;
}

export function buildGraph(scanResult: ScanResult, allRepoNames: string[]): DependencyGraph {
  const startTime = Date.now();

  // Build nodes
  const nodeMap = new Map<string, GraphNode>();
  for (const name of allRepoNames) {
    nodeMap.set(name, {
      id: name,
      name,
      language: scanResult.repoLanguages.get(name) || Language.Unknown,
      url: scanResult.repoUrls.get(name) || "",
      inDegree: 0,
      outDegree: 0,
      databases: [],
      publishedPackages: [],
      consumedPackages: [],
      consumedServices: [],
    });
  }

  // Aggregate dependencies into edges
  const edgeKey = (source: string, target: string, type: string) => `${source}→${target}:${type}`;
  const edgeMap = new Map<
    string,
    { source: string; target: string; type: DependencyType; details: EdgeDetail[] }
  >();

  for (const dep of scanResult.dependencies) {
    // Ensure both repos exist as nodes
    if (!nodeMap.has(dep.sourceRepo) || !nodeMap.has(dep.targetRepo)) {
      const missing = !nodeMap.has(dep.sourceRepo) ? dep.sourceRepo : dep.targetRepo;
      console.warn(
        `GraphBuilder: dropping dependency ${dep.sourceRepo} → ${dep.targetRepo} (${dep.type}): "${missing}" not in repo list`
      );
      continue;
    }

    const key = edgeKey(dep.sourceRepo, dep.targetRepo, dep.type);
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        source: dep.sourceRepo,
        target: dep.targetRepo,
        type: dep.type,
        details: [],
      });
    }
    edgeMap.get(key)!.details.push({
      description: dep.detail,
      sourceFile: dep.sourceFile,
      type: dep.type,
      confidence: dep.confidence,
      version: dep.version,
    });
  }

  // Build graph edges
  const edges: GraphEdge[] = [];
  const typeBreakdown: Record<string, number> = {};
  for (const [, edge] of edgeMap) {
    const type = edge.type;
    typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
    edges.push({
      id: `${edge.source}→${edge.target}:${edge.type}`,
      source: edge.source,
      target: edge.target,
      type,
      confidence: bestConfidence(edge.details),
      details: edge.details,
      weight: edge.details.length,
    });
  }

  // Filter out self-loop edges
  const filteredEdges = edges.filter((edge) => edge.source !== edge.target);

  // Populate node metadata from scan result
  if (scanResult.repoMetadata) {
    for (const [name, meta] of scanResult.repoMetadata) {
      const node = nodeMap.get(name);
      if (!node) continue;
      node.databases = meta.databases;
      node.publishedPackages = meta.publishedPackages;
      node.consumedServices = meta.consumedServices;
    }
  }

  // Populate consumedPackages from NuGet/Maven dependency edges
  for (const dep of scanResult.dependencies) {
    if (dep.type !== DependencyType.NuGet && dep.type !== DependencyType.Maven) continue;
    const node = nodeMap.get(dep.sourceRepo);
    if (!node) continue;
    // Extract package name from detail: 'PackageReference "Foo.Bar" ...' or 'Maven dependency "g:a" ...'
    const pkgMatch = dep.detail.match(/"([^"]+)"/);
    if (pkgMatch && !node.consumedPackages.includes(pkgMatch[1])) {
      node.consumedPackages.push(pkgMatch[1]);
    }
  }

  // Calculate in/out degrees
  for (const edge of filteredEdges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (source) source.outDegree++;
    if (target) target.inDegree++;
  }

  const nodes = [...nodeMap.values()];
  const nodeIds = nodes.map((n) => n.id);

  // Analysis
  const rawCycles = detectCycles(nodeIds, filteredEdges);
  const cycles = suggestCycleBreaks(rawCycles);
  const deploymentTiers = topologicalSort(nodeIds, filteredEdges);
  const isolatedRepos = nodes.filter((n) => n.inDegree === 0 && n.outDegree === 0).length;

  // Graph metrics
  const totalDegree = nodes.reduce((s, n) => s + n.inDegree + n.outDegree, 0);
  const avgDegree = nodes.length > 0 ? totalDegree / nodes.length : 0;
  // Count unique directed pairs (ignoring multi-type edges between same pair)
  const uniquePairs = new Set(filteredEdges.map((e) => `${e.source}→${e.target}`));
  const maxPossibleEdges = nodes.length * (nodes.length - 1);
  const graphDensity = maxPossibleEdges > 0 ? uniquePairs.size / maxPossibleEdges : 0;

  const stats: GraphStats = {
    totalRepos: nodes.length,
    totalEdges: filteredEdges.length,
    isolatedRepos,
    maxDepth: deploymentTiers.length,
    cycleCount: cycles.length,
    scanDurationMs: Date.now() - startTime,
    graphDensity: Math.round(graphDensity * 10000) / 10000,
    avgDegree: Math.round(avgDegree * 100) / 100,
    typeBreakdown,
  };

  return { nodes, edges: filteredEdges, deploymentTiers, cycles, stats };
}
