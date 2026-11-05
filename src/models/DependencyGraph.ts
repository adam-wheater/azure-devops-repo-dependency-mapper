import { Confidence, DependencyType, Language } from "./DependencyTypes";

export interface ServiceInstance {
  serviceType: string;
  instanceId: string;
  detectedFrom: string;
}

export interface GraphNode {
  id: string;
  name: string;
  language: Language;
  url: string;
  inDegree: number;
  outDegree: number;
  databases: string[];
  publishedPackages: string[];
  consumedPackages: string[];
  consumedServices: ServiceInstance[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: DependencyType;
  confidence: Confidence;
  details: EdgeDetail[];
  weight: number;
}

export interface EdgeDetail {
  description: string;
  sourceFile: string;
  type: DependencyType;
  confidence: Confidence;
  version?: string;
}

export interface DeploymentTier {
  tier: number;
  label: string;
  repos: string[];
}

export interface CycleGroup {
  repos: string[];
  edges: GraphEdge[];
  breakSuggestion?: CycleBreakSuggestion;
}

export interface CycleBreakSuggestion {
  edge: GraphEdge;
  reason: string;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  deploymentTiers: DeploymentTier[];
  cycles: CycleGroup[];
  stats: GraphStats;
}

export interface GraphStats {
  totalRepos: number;
  totalEdges: number;
  isolatedRepos: number;
  maxDepth: number;
  cycleCount: number;
  scanDurationMs: number;
  graphDensity: number;
  avgDegree: number;
  typeBreakdown: Record<string, number>;
}

export interface ScanProgress {
  phase: "discovery" | "scanning" | "analysis" | "complete";
  reposTotal: number;
  reposCompleted: number;
  currentRepo: string;
  message: string;
  failedRepos?: string[];
}

export interface DependencyDiffResult {
  added: GraphEdge[];
  removed: GraphEdge[];
  changed: Array<{ edge: GraphEdge; previousConfidence: Confidence }>;
  addedNodes: string[];
  removedNodes: string[];
}
