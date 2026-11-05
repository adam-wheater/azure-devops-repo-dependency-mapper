import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IProjectPageService } from "azure-devops-extension-api";
import {
  DependencyGraph,
  DependencyDiffResult,
  GraphEdge,
  GraphNode,
  ScanProgress,
} from "../models/DependencyGraph";
import { DependencyType, Confidence, Language } from "../models/DependencyTypes";
import { CacheManager } from "../caching/CacheManager";
import { ScanOrchestrator } from "../scanning/ScanOrchestrator";
import { buildGraph } from "../analysis/GraphBuilder";
import { diffGraphs } from "../analysis/DependencyDiff";
import { ForceGraph } from "../visualization/ForceGraph";
import { GraphLegend } from "../visualization/GraphLegend";
import { BRAND, BrandGlyph } from "../brand";
import {
  AppShell,
  Banner,
  Button,
  ErrorBoundary,
  IconInfo,
  IconPlay,
  IconRefresh,
  IconStop,
  Metric,
  Modal,
} from "./ui";
import { ControlBar } from "./ControlBar";
import { FilterPanel, FilterState, applyFilters } from "./FilterPanel";
import { DetailPanel } from "./DetailPanel";
import { DeploymentOrderView } from "./DeploymentOrderView";
import { ScanProgressBar } from "./ScanProgressBar";
import { PathFinderPanel } from "./PathFinderPanel";
import { InfraResource } from "../scanning/detectors/InfraDetector";

const cache = new CacheManager();

const AppInner: React.FC = () => {
  const [projectName, setProjectName] = React.useState<string | null>(null);
  const projectNameRef = React.useRef(projectName);
  React.useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);
  const [fullGraph, setFullGraph] = React.useState<DependencyGraph | null>(null);
  const fullGraphRef = React.useRef(fullGraph);
  React.useEffect(() => {
    fullGraphRef.current = fullGraph;
  }, [fullGraph]);
  const [filteredGraph, setFilteredGraph] = React.useState<DependencyGraph | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [progress, setProgress] = React.useState<ScanProgress | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedNode, setSelectedNode] = React.useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = React.useState<GraphEdge | null>(null);
  const [infraResources, setInfraResources] = React.useState<InfraResource[]>([]);
  const [deploymentExpanded, setDeploymentExpanded] = React.useState(false);
  const [reverseSearch, setReverseSearch] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [pinnedNodes, setPinnedNodes] = React.useState<Set<string>>(new Set());
  const [graphDiff, setGraphDiff] = React.useState<DependencyDiffResult | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showPathFinder, setShowPathFinder] = React.useState(false);
  const [pathSource, setPathSource] = React.useState("");
  const [pathTarget, setPathTarget] = React.useState("");
  const [pathResults, setPathResults] = React.useState<string[][] | null>(null);
  const [filters, setFilters] = React.useState<FilterState>({
    types: new Set(Object.values(DependencyType)),
    repos: new Set(),
    minConfidence: Confidence.Low,
    showIsolated: true,
    repoFilterActive: false,
    languages: new Set(Object.values(Language)),
  });

  // Generation counter to prevent stale scan results from overwriting newer ones
  const scanGenRef = React.useRef(0);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (fullGraph) {
      setFilteredGraph(applyFilters(fullGraph, filters));
    }
  }, [fullGraph, filters]);

  const handlePinToggle = React.useCallback((nodeId: string) => {
    setPinnedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleCancelScan = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleScan = React.useCallback(async (force: boolean) => {
    // Cancel any in-flight scan
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const thisGen = ++scanGenRef.current;
    setScanning(true);
    setProgress(null);
    setScanError(null);
    setSelectedNode(null);
    setSelectedEdge(null);

    try {
      const orchestrator = new ScanOrchestrator(
        cache,
        (p) => {
          if (scanGenRef.current === thisGen) {
            setProgress(p);
          }
        },
        abortController.signal
      );
      const result = await orchestrator.scan(force);

      if (scanGenRef.current !== thisGen) return;

      const graph = buildGraph(result, result.allRepoNames);

      // Compute diff if we had a previous graph
      const currentGraph = fullGraphRef.current;
      if (currentGraph) {
        setGraphDiff(diffGraphs(currentGraph, graph));
      }

      setFullGraph(graph);
      setInfraResources(result.infraResources);
      const proj = projectNameRef.current;
      if (proj) cache.set(`last-graph:${proj}`, graph);
    } catch (err) {
      if (scanGenRef.current === thisGen) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setScanError("Scan was cancelled.");
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setScanError(`Scan failed: ${message}`);
          console.error("Scan failed:", err);
        }
      }
    } finally {
      if (scanGenRef.current === thisGen) {
        setScanning(false);
        setProgress(null);
        abortControllerRef.current = null;
      }
    }
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "") &&
        !document.activeElement?.hasAttribute("contenteditable")
      ) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Resolve project name and load project-scoped cached graph on mount
  React.useEffect(() => {
    SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService)
      .then((svc) => svc.getProject())
      .then((info) => {
        if (info) {
          setProjectName(info.name);
          const cached = cache.get<DependencyGraph>(`last-graph:${info.name}`);
          if (cached) setFullGraph(cached);
        }
      })
      .catch(() => {
        // Project resolution failed — cache won't load but scan still works
      });
  }, []);

  const stats = fullGraph?.stats;
  const diffHasChanges =
    graphDiff !== null &&
    (graphDiff.added.length > 0 || graphDiff.removed.length > 0 || graphDiff.changed.length > 0);
  const subtitle = projectName ? `${BRAND.tagline} · ${projectName}` : BRAND.tagline;

  return (
    <AppShell
      title={BRAND.name}
      subtitle={subtitle}
      mark={<BrandGlyph />}
      actions={
        <>
          <Button
            variant="primary"
            icon={<IconPlay />}
            busy={scanning}
            onClick={() => handleScan(false)}
          >
            {scanning ? "Scanning..." : "Scan all repos"}
          </Button>
          <Button
            icon={<IconRefresh />}
            disabled={scanning}
            onClick={() => handleScan(true)}
            title="Ignore the cache and scan everything"
          >
            Full rescan
          </Button>
          {scanning && (
            <Button
              variant="danger"
              icon={<IconStop />}
              onClick={handleCancelScan}
              title="Cancel the current scan"
            >
              Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            className="ax-btn--icon"
            onClick={() => setShowHelp(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <IconInfo />
          </Button>
        </>
      }
    >
      <ScanProgressBar progress={progress} />

      {scanError && (
        <div className="ax-section">
          <Banner tone="error" onDismiss={() => setScanError(null)}>
            {scanError}
          </Banner>
        </div>
      )}

      {graphDiff && diffHasChanges && (
        <div className="ax-section">
          <Banner
            tone="info"
            title="Changes since the previous scan"
            onDismiss={() => setGraphDiff(null)}
          >
            +{graphDiff.added.length} -{graphDiff.removed.length} ~{graphDiff.changed.length} edges
            {graphDiff.addedNodes.length > 0 && `, +${graphDiff.addedNodes.length} repos`}
            {graphDiff.removedNodes.length > 0 && `, -${graphDiff.removedNodes.length} repos`}
          </Banner>
        </div>
      )}

      {stats && (
        <div className="ax-metrics">
          <Metric
            label="Repositories"
            value={stats.totalRepos}
            hint={`Average degree ${stats.avgDegree}`}
            tone="accent"
          />
          <Metric
            label="Dependencies"
            value={stats.totalEdges}
            hint={`Graph density ${stats.graphDensity}`}
            tone="info"
          />
          <Metric
            label="Cycles"
            value={stats.cycleCount}
            hint={stats.cycleCount > 0 ? "Circular dependency groups" : "No circular dependencies"}
            tone={stats.cycleCount > 0 ? "danger" : "success"}
          />
          <Metric
            label="Isolated"
            value={stats.isolatedRepos}
            hint="Repos with no detected links"
            tone="neutral"
          />
        </div>
      )}

      <ControlBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        graph={fullGraph}
        reverseSearch={reverseSearch}
        onReverseSearchToggle={() => setReverseSearch((prev) => !prev)}
        onTogglePathFinder={() => setShowPathFinder((prev) => !prev)}
        showPathFinder={showPathFinder}
      />

      {showPathFinder && fullGraph && (
        <PathFinderPanel
          graph={fullGraph}
          pathSource={pathSource}
          pathTarget={pathTarget}
          pathResults={pathResults}
          onSourceChange={setPathSource}
          onTargetChange={setPathTarget}
          onPathResults={setPathResults}
        />
      )}

      <div role="main" className="dm-workspace">
        <FilterPanel graph={fullGraph} filters={filters} onChange={setFilters} />

        <section className="ax-card dm-graph" aria-label="Dependency graph">
          <div className="dm-canvas">
            <ForceGraph
              graph={filteredGraph}
              searchTerm={searchTerm}
              reverseSearch={reverseSearch}
              onNodeClick={setSelectedNode}
              onEdgeClick={setSelectedEdge}
              pinnedNodes={pinnedNodes}
              onPinToggle={handlePinToggle}
              graphDiff={graphDiff}
            />
            <GraphLegend />
          </div>
        </section>

        <DetailPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          infraResources={infraResources}
          allEdges={fullGraph?.edges || []}
          onPinToggle={handlePinToggle}
          pinnedNodes={pinnedNodes}
          graph={fullGraph}
          onNodeClick={setSelectedNode}
        />
      </div>

      <DeploymentOrderView
        graph={fullGraph}
        expanded={deploymentExpanded}
        onToggle={() => setDeploymentExpanded((prev) => !prev)}
      />

      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}

      <footer className="ax-footer">
        <span>{BRAND.name}</span>
        <span>Runs entirely in your browser · no data leaves Azure DevOps</span>
      </footer>
    </AppShell>
  );
};

export const App: React.FC = () => (
  <ErrorBoundary>
    <AppInner />
  </ErrorBoundary>
);

const SHORTCUTS: [string, string][] = [
  ["/", "Focus search"],
  ["Escape", "Clear search / close dialog"],
  ["?", "Toggle this help dialog"],
  ["Tab", "In the graph: select a repository, then step through its links"],
  ["Arrow keys", "Select the next or previous repository"],
  ["Enter", "Show the selected repository's details"],
];

const HelpDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Modal title="Keyboard shortcuts" onClose={onClose}>
    <table className="dm-shortcuts">
      <tbody>
        {SHORTCUTS.map(([key, desc]) => (
          <tr key={key}>
            <td>
              <kbd className="dm-kbd">{key}</kbd>
            </td>
            <td>{desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Modal>
);
