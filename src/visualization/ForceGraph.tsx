import * as React from "react";
import {
  DependencyGraph,
  DependencyDiffResult,
  GraphEdge,
  GraphNode,
} from "../models/DependencyGraph";
import { Button, EmptyState, Pill } from "../components/ui";
import { GraphRenderer } from "./GraphRenderer";

interface ForceGraphProps {
  graph: DependencyGraph | null;
  searchTerm: string;
  reverseSearch: boolean;
  onNodeClick: (node: GraphNode | null) => void;
  onEdgeClick: (edge: GraphEdge | null) => void;
  pinnedNodes: Set<string>;
  onPinToggle: (nodeId: string) => void;
  graphDiff?: DependencyDiffResult | null;
}

export const ForceGraph: React.FC<ForceGraphProps> = ({
  graph,
  searchTerm,
  reverseSearch,
  onNodeClick,
  onEdgeClick,
  pinnedNodes,
  onPinToggle,
  graphDiff,
}) => {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const rendererRef = React.useRef<GraphRenderer | null>(null);
  const [rendering, setRendering] = React.useState(false);

  // Keep callbacks in refs to avoid stale closures
  const onNodeClickRef = React.useRef(onNodeClick);
  const onEdgeClickRef = React.useRef(onEdgeClick);
  onNodeClickRef.current = onNodeClick;
  onEdgeClickRef.current = onEdgeClick;

  React.useEffect(() => {
    if (!svgRef.current) return;
    rendererRef.current = new GraphRenderer(svgRef.current);
    rendererRef.current.setCallbacks(
      (node) => onNodeClickRef.current(node),
      (edge) => onEdgeClickRef.current(edge),
      () => setRendering(false)
    );

    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (graph && rendererRef.current) {
      setRendering(true);
      rendererRef.current.render(graph, graphDiff ?? undefined);
    }
  }, [graph]);

  React.useEffect(() => {
    if (rendererRef.current) {
      if (reverseSearch) {
        rendererRef.current.highlightDependents(searchTerm);
      } else {
        rendererRef.current.highlightSearch(searchTerm);
      }
    }
  }, [searchTerm, reverseSearch]);

  // Apply pin state — track previous set to detect unpins
  const prevPinnedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!rendererRef.current) return;
    const prev = prevPinnedRef.current;
    // Unpin nodes that were removed from the pinned set
    for (const nodeId of prev) {
      if (!pinnedNodes.has(nodeId)) {
        rendererRef.current.unpinNode(nodeId);
      }
    }
    // Pin nodes that were added to the pinned set
    for (const nodeId of pinnedNodes) {
      if (!prev.has(nodeId)) {
        rendererRef.current.pinNode(nodeId);
      }
    }
    prevPinnedRef.current = new Set(pinnedNodes);
  }, [pinnedNodes, graph]);

  const handleBackgroundClick = React.useCallback(() => {
    rendererRef.current?.clearHighlight();
    onNodeClickRef.current(null);
    onEdgeClickRef.current(null);
  }, []);

  const handleResetZoom = React.useCallback(() => {
    rendererRef.current?.resetZoom();
  }, []);

  const handleUnpinAll = React.useCallback(() => {
    rendererRef.current?.unpinAll();
    // Clear parent state for each pinned node
    if (pinnedNodes && onPinToggle) {
      for (const nodeId of pinnedNodes) {
        onPinToggle(nodeId);
      }
    }
  }, [pinnedNodes, onPinToggle]);

  return (
    <div className="dm-canvas">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Repository dependency graph"
        className="dm-svg"
        onClick={handleBackgroundClick}
      />
      {rendering && (
        <div className="dm-overlay-badge">
          <Pill tone="info">Rendering graph...</Pill>
        </div>
      )}
      {graph && (
        <div className="dm-overlay">
          <Button
            size="sm"
            onClick={handleResetZoom}
            title="Reset zoom and pan"
            aria-label="Reset zoom"
          >
            Reset view
          </Button>
          {pinnedNodes.size > 0 && (
            <Button
              size="sm"
              onClick={handleUnpinAll}
              title="Unpin all pinned nodes"
              aria-label="Unpin all nodes"
            >
              Unpin all ({pinnedNodes.size})
            </Button>
          )}
        </div>
      )}
      {graph && graph.nodes.length === 0 && (
        <div className="dm-canvas-empty">
          <EmptyState title="No results match current filters">
            Adjust the filter panel to see more nodes and edges.
          </EmptyState>
        </div>
      )}
      {!graph && (
        <div className="dm-canvas-empty">
          <EmptyState title="No dependency graph yet">
            <p>
              Click <strong>Scan all repos</strong> to discover dependencies.
            </p>
            <p>
              Press <kbd className="dm-kbd">/</kbd> to search, <kbd className="dm-kbd">?</kbd> for
              keyboard shortcuts.
            </p>
          </EmptyState>
        </div>
      )}
    </div>
  );
};
