import * as d3 from "d3";
import {
  DependencyGraph,
  DependencyDiffResult,
  GraphEdge,
  GraphNode,
} from "../models/DependencyGraph";
import { DEPENDENCY_COLORS, LANGUAGE_COLORS, FORCE_CONFIG } from "../utils/Constants";
import { Confidence, DependencyType, Language } from "../models/DependencyTypes";

// Colours the renderer picks itself, as design-system tokens so they follow the theme.
const DIFF_ADDED_COLOR = "var(--ax-success)";
const DIFF_CHANGED_COLOR = "var(--ax-warn)";
const SEED_RING_COLOR = "var(--ax-warn)";
const NODE_RING_COLOR = "var(--dm-canvas)";

export interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  language: Language;
  inDegree: number;
  outDegree: number;
}

export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  type: DependencyType;
  weight: number;
  confidence: Confidence;
}

export class GraphRenderer {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private simulation: d3.Simulation<SimNode, SimLink> | null = null;
  private linkGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private nodeGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private labelGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private container!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private graphNodeMap = new Map<string, GraphNode>();
  private graphEdgeMap = new Map<string, GraphEdge>();
  private linkCounts = new Map<string, number>();
  private linkIndexMap = new Map<string, number>();
  private pinnedNodeIds = new Set<string>();
  private dragging = false;
  private dragEndTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedNodeId: string | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private onNodeClick?: (node: GraphNode | null) => void;
  private onEdgeClick?: (edge: GraphEdge | null) => void;
  private onSimulationEnd?: () => void;
  private savedTransform: d3.ZoomTransform | null = null;
  private addedEdgeIds = new Set<string>();
  private removedEdgeIds = new Set<string>();
  private changedEdgeIds = new Set<string>();
  private addedNodeIds = new Set<string>();
  private removedNodeIds = new Set<string>();

  constructor(svgElement: SVGSVGElement) {
    this.svg = d3.select(svgElement);
    this.setupSvg();
    this.setupKeyboardNav();
  }

  private setupSvg(): void {
    this.svg.selectAll("*").remove();

    const defs = this.svg.append("defs");
    for (const [type, color] of Object.entries(DEPENDENCY_COLORS)) {
      defs
        .append("marker")
        .attr("id", `arrow-${type}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .style("fill", color);
    }

    this.container = this.svg.append("g").attr("class", "graph-container");
    this.linkGroup = this.container.append("g").attr("class", "links");
    this.nodeGroup = this.container.append("g").attr("class", "nodes");
    this.labelGroup = this.container.append("g").attr("class", "labels");
  }

  setCallbacks(
    onNodeClick: (node: GraphNode | null) => void,
    onEdgeClick: (edge: GraphEdge | null) => void,
    onSimulationEnd?: () => void
  ): void {
    this.onNodeClick = onNodeClick;
    this.onEdgeClick = onEdgeClick;
    this.onSimulationEnd = onSimulationEnd;
  }

  render(graph: DependencyGraph, diff?: DependencyDiffResult): void {
    // Stop previous simulation before creating new one
    this.simulation?.stop();
    this.simulation = null;

    // Preserve current zoom/pan transform before rebuilding DOM
    const svgNode = this.svg.node();
    if (svgNode) {
      this.savedTransform = d3.zoomTransform(svgNode);
    }

    // Populate diff sets for visual treatment
    this.addedEdgeIds.clear();
    this.removedEdgeIds.clear();
    this.changedEdgeIds.clear();
    this.addedNodeIds.clear();
    this.removedNodeIds.clear();
    if (diff) {
      for (const edge of diff.added) this.addedEdgeIds.add(edge.id);
      for (const edge of diff.removed) this.removedEdgeIds.add(edge.id);
      for (const item of diff.changed) this.changedEdgeIds.add(item.edge.id);
      for (const nodeId of diff.addedNodes) this.addedNodeIds.add(nodeId);
      for (const nodeId of diff.removedNodes) this.removedNodeIds.add(nodeId);
    }

    this.graphNodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    this.nodes = graph.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      language: n.language,
      inDegree: n.inDegree,
      outDegree: n.outDegree,
    }));

    const nodeById = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = graph.edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({
        id: e.id,
        source: nodeById.get(e.source)!,
        target: nodeById.get(e.target)!,
        type: e.type,
        weight: e.weight,
        confidence: e.confidence,
      }));

    // Compute parallel edge indices for curved rendering
    this.linkCounts = new Map();
    this.linkIndexMap = new Map();
    for (const link of this.links) {
      const sId = (link.source as SimNode).id;
      const tId = (link.target as SimNode).id;
      const combinedKey = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
      const count = (this.linkCounts.get(combinedKey) || 0) + 1;
      this.linkCounts.set(combinedKey, count);
      this.linkIndexMap.set(link.id, count - 1);
    }

    this.renderLinks(graph.edges);
    this.renderNodes(graph.nodes);
    this.renderLabels();
    this.startSimulation();
    this.setupZoom();
  }

  private renderLinks(graphEdges: GraphEdge[]): void {
    this.graphEdgeMap = new Map(graphEdges.map((e) => [e.id, e]));

    this.linkGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .data(this.links, (d) => d.id)
      .join("path")
      .style("stroke", (d) => {
        if (this.addedEdgeIds.has(d.id)) return DIFF_ADDED_COLOR;
        if (this.changedEdgeIds.has(d.id)) return DIFF_CHANGED_COLOR;
        return DEPENDENCY_COLORS[d.type] || "var(--ax-text-4)";
      })
      .attr("stroke-width", (d) => {
        if (this.addedEdgeIds.has(d.id) || this.changedEdgeIds.has(d.id)) {
          return Math.min(2 + d.weight, 8);
        }
        return Math.min(1 + d.weight, 6);
      })
      .attr("stroke-opacity", (d) => this.confidenceOpacity(d.confidence))
      .attr("stroke-dasharray", (d) => {
        if (this.addedEdgeIds.has(d.id)) return "6,3";
        if (this.changedEdgeIds.has(d.id)) return "4,2";
        return null;
      })
      .style("fill", "none")
      .attr("marker-end", (d) => `url(#arrow-${d.type})`)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        const edge = this.graphEdgeMap.get(d.id);
        this.onEdgeClick?.(edge || null);
      });
  }

  private confidenceOpacity(confidence: Confidence): number {
    switch (confidence) {
      case Confidence.High:
        return 0.8;
      case Confidence.Medium:
        return 0.5;
      case Confidence.Low:
        return 0.25;
      default:
        return 0.5;
    }
  }

  private renderNodes(_graphNodes: GraphNode[]): void {
    // graphNodeMap is already set in render() before renderNodes is called

    const circles = this.nodeGroup
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(this.nodes, (d) => d.id)
      .join("circle")
      .attr("r", (d) => Math.max(8, 8 + Math.log2(d.inDegree + d.outDegree + 1) * 5))
      .style("fill", (d) => LANGUAGE_COLORS[d.language] || LANGUAGE_COLORS[Language.Unknown])
      .style("stroke", (d) => (this.addedNodeIds.has(d.id) ? DIFF_ADDED_COLOR : NODE_RING_COLOR))
      .attr("stroke-width", (d) => (this.addedNodeIds.has(d.id) ? 3 : 2))
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        // Ignore clicks that happen at the end of a drag
        if (this.dragging) return;
        event.stopPropagation();
        this.selectedNodeId = d.id;
        const node = this.graphNodeMap.get(d.id);
        this.onNodeClick?.(node || null);
        this.highlightConnected(d.id);
      })
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        const node = this.graphNodeMap.get(d.id);
        if (node?.url) {
          try {
            window.open(node.url, "_blank", "noopener,noreferrer");
          } catch {
            // URL open failed
          }
        }
      });

    circles.call(
      d3
        .drag<SVGCircleElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) this.simulation?.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          this.dragging = true;
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) this.simulation?.alphaTarget(0);
          // Only release position if the node is not pinned
          if (!this.pinnedNodeIds.has(d.id)) {
            d.fx = null;
            d.fy = null;
          }
          // Delay clearing drag flag so click handler can check it
          this.dragEndTimer = setTimeout(() => {
            this.dragging = false;
            this.dragEndTimer = null;
          }, 50);
        })
    );
  }

  private renderLabels(): void {
    this.labelGroup
      .selectAll<SVGTextElement, SimNode>("text")
      .data(this.nodes, (d) => d.id)
      .join("text")
      .text((d) => d.name)
      .attr("class", "dm-label")
      .attr("dy", -15);
  }

  private startSimulation(): void {
    const width = this.svg.node()?.clientWidth || 800;
    const height = this.svg.node()?.clientHeight || 600;
    const nodeCount = this.nodes.length;

    // Adaptive scaling capped at 2x to prevent excessive spread
    const scale = nodeCount > 20 ? Math.min(2, 1 + Math.log2(nodeCount / 20) * 0.3) : 1;
    const charge = FORCE_CONFIG.chargeStrength * scale;
    const linkDist = FORCE_CONFIG.linkDistance * scale;
    const collide = FORCE_CONFIG.collideRadius * scale;

    this.simulation = d3
      .forceSimulation<SimNode>(this.nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(this.links)
          .id((d) => d.id)
          .distance(linkDist)
      )
      .force("charge", d3.forceManyBody().strength(charge))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(FORCE_CONFIG.centerStrength))
      // forceCenter only moves the mean, so a repo with no links would drift off the
      // canvas. A weak pull to the middle keeps every node in view.
      .force("x", d3.forceX(width / 2).strength(0.02))
      .force("y", d3.forceY(height / 2).strength(0.02))
      .force("collide", d3.forceCollide(collide))
      .alphaDecay(FORCE_CONFIG.alphaDecay)
      .velocityDecay(FORCE_CONFIG.velocityDecay)
      .on("tick", () => this.tick())
      .on("end", () => this.onSimulationEnd?.());
  }

  /** Returns the visible viewport bounds in graph coordinates, accounting for zoom. */
  private getViewport(): { x0: number; y0: number; x1: number; y1: number } | null {
    const svgNode = this.svg.node();
    if (!svgNode) return null;
    const w = svgNode.clientWidth;
    const h = svgNode.clientHeight;
    const t = d3.zoomTransform(svgNode);
    // Invert screen corners to get graph coordinates
    return {
      x0: (0 - t.x) / t.k,
      y0: (0 - t.y) / t.k,
      x1: (w - t.x) / t.k,
      y1: (h - t.y) / t.k,
    };
  }

  private tick(): void {
    // Only cull when graph is large enough to benefit (100+ nodes)
    const shouldCull = this.nodes.length >= 100;
    const vp = shouldCull ? this.getViewport() : null;
    const margin = 100; // extra margin to avoid popping
    const visibleNodes = vp
      ? new Set(
          this.nodes
            .filter(
              (n) =>
                (n.x || 0) >= vp.x0 - margin &&
                (n.x || 0) <= vp.x1 + margin &&
                (n.y || 0) >= vp.y0 - margin &&
                (n.y || 0) <= vp.y1 + margin
            )
            .map((n) => n.id)
        )
      : null;

    this.linkGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .attr("d", (d) => {
        const source = d.source as SimNode;
        const target = d.target as SimNode;
        const sx = source.x || 0;
        const sy = source.y || 0;
        const tx = target.x || 0;
        const ty = target.y || 0;

        const sId = source.id;
        const tId = target.id;
        const combinedKey = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
        const totalLinks = this.linkCounts.get(combinedKey) || 1;
        const linkIndex = this.linkIndexMap.get(d.id) || 0;

        if (totalLinks <= 1) {
          return `M${sx},${sy}L${tx},${ty}`;
        }

        // Multiple edges between same pair: curve with perpendicular offset
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = (linkIndex - (totalLinks - 1) / 2) * 30;
        const nx = -dy / len;
        const ny = dx / len;
        const mx = (sx + tx) / 2 + nx * offset;
        const my = (sy + ty) / 2 + ny * offset;

        return `M${sx},${sy}Q${mx},${my} ${tx},${ty}`;
      })
      .attr(
        "visibility",
        visibleNodes
          ? (d) => {
              const sId = (d.source as SimNode).id;
              const tId = (d.target as SimNode).id;
              return visibleNodes.has(sId) || visibleNodes.has(tId) ? "visible" : "hidden";
            }
          : null
      );

    this.nodeGroup
      .selectAll<SVGCircleElement, SimNode>("circle")
      .attr("cx", (d) => d.x || 0)
      .attr("cy", (d) => d.y || 0)
      .attr(
        "visibility",
        visibleNodes ? (d) => (visibleNodes.has(d.id) ? "visible" : "hidden") : null
      );

    this.labelGroup
      .selectAll<SVGTextElement, SimNode>("text")
      .attr("x", (d) => d.x || 0)
      .attr("y", (d) => d.y || 0)
      .attr(
        "visibility",
        visibleNodes ? (d) => (visibleNodes.has(d.id) ? "visible" : "hidden") : null
      );
  }

  private zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;

  private setupZoom(): void {
    if (!this.zoom) {
      this.zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
          this.container.attr("transform", event.transform);
        });
    }
    this.svg.call(this.zoom);

    // Restore previous zoom/pan transform if available
    if (this.savedTransform !== null) {
      this.svg.call(this.zoom.transform, this.savedTransform);
      this.savedTransform = null;
    }
  }

  resetZoom(): void {
    if (this.zoom) {
      this.svg.transition().duration(500).call(this.zoom.transform, d3.zoomIdentity);
    }
  }

  pinNode(nodeId: string): void {
    this.pinnedNodeIds.add(nodeId);
    const node = this.nodes.find((n) => n.id === nodeId);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
    }
  }

  unpinNode(nodeId: string): void {
    this.pinnedNodeIds.delete(nodeId);
    const node = this.nodes.find((n) => n.id === nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
  }

  unpinAll(): void {
    this.pinnedNodeIds.clear();
    for (const node of this.nodes) {
      node.fx = null;
      node.fy = null;
    }
    this.simulation?.alpha(0.3).restart();
  }

  highlightConnected(nodeId: string): void {
    const connectedNodes = new Set<string>([nodeId]);
    const connectedEdges = new Set<string>();

    for (const link of this.links) {
      const sourceId =
        typeof link.source === "object" ? (link.source as SimNode).id : String(link.source);
      const targetId =
        typeof link.target === "object" ? (link.target as SimNode).id : String(link.target);
      if (sourceId === nodeId || targetId === nodeId) {
        connectedNodes.add(sourceId);
        connectedNodes.add(targetId);
        connectedEdges.add(link.id);
      }
    }

    this.nodeGroup
      .selectAll<SVGCircleElement, SimNode>("circle")
      .attr("opacity", (d) => (connectedNodes.has(d.id) ? 1 : 0.15));

    this.labelGroup
      .selectAll<SVGTextElement, SimNode>("text")
      .attr("opacity", (d) => (connectedNodes.has(d.id) ? 1 : 0.15));

    this.linkGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .attr("stroke-opacity", (d) => (connectedEdges.has(d.id) ? 1 : 0.05));
  }

  clearHighlight(): void {
    this.selectedNodeId = null;
    this.nodeGroup
      .selectAll("circle")
      .attr("opacity", 1)
      .style("stroke", NODE_RING_COLOR)
      .attr("stroke-width", 2);
    this.labelGroup.selectAll("text").attr("opacity", 1);
    this.linkGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .attr("stroke-opacity", (d) => this.confidenceOpacity(d.confidence));
  }

  highlightSearch(term: string): void {
    if (!term) {
      this.clearHighlight();
      return;
    }
    const lower = term.toLowerCase();
    this.nodeGroup
      .selectAll<SVGCircleElement, SimNode>("circle")
      .attr("opacity", (d) => (d.name.toLowerCase().includes(lower) ? 1 : 0.15));
    this.labelGroup
      .selectAll<SVGTextElement, SimNode>("text")
      .attr("opacity", (d) => (d.name.toLowerCase().includes(lower) ? 1 : 0.15));
  }

  /**
   * Reverse search: highlight all repos that depend on repos matching the term.
   * Walks inbound edges transitively to find the full set of dependents.
   */
  highlightDependents(term: string): void {
    if (!term) {
      this.clearHighlight();
      return;
    }
    const lower = term.toLowerCase();

    // Find seed nodes matching the search term
    const seeds = new Set<string>();
    for (const node of this.nodes) {
      if (node.name.toLowerCase().includes(lower)) {
        seeds.add(node.id);
      }
    }
    if (seeds.size === 0) {
      this.clearHighlight();
      return;
    }

    // BFS: walk inbound edges from seeds to find all dependents
    const dependents = new Set<string>(seeds);
    const queue = [...seeds];
    const connectedEdges = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of this.links) {
        const targetId =
          typeof link.target === "object" ? (link.target as SimNode).id : String(link.target);
        const sourceId =
          typeof link.source === "object" ? (link.source as SimNode).id : String(link.source);
        if (targetId === current && !dependents.has(sourceId)) {
          dependents.add(sourceId);
          connectedEdges.add(link.id);
          queue.push(sourceId);
        }
        // Also highlight outbound edges from seed for visual context
        // (shows what the seed depends on, but does NOT add targets to dependents set)
        if (sourceId === current && seeds.has(current)) {
          connectedEdges.add(link.id);
        }
      }
    }

    // Mark edges connecting dependents to seeds
    for (const link of this.links) {
      const sourceId =
        typeof link.source === "object" ? (link.source as SimNode).id : String(link.source);
      const targetId =
        typeof link.target === "object" ? (link.target as SimNode).id : String(link.target);
      if (dependents.has(sourceId) && dependents.has(targetId)) {
        connectedEdges.add(link.id);
      }
    }

    this.nodeGroup
      .selectAll<SVGCircleElement, SimNode>("circle")
      .attr("opacity", (d) => (dependents.has(d.id) ? 1 : 0.1))
      .style("stroke", (d) => (seeds.has(d.id) ? SEED_RING_COLOR : NODE_RING_COLOR))
      .attr("stroke-width", (d) => (seeds.has(d.id) ? 3 : 2));

    this.labelGroup
      .selectAll<SVGTextElement, SimNode>("text")
      .attr("opacity", (d) => (dependents.has(d.id) ? 1 : 0.1));

    this.linkGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .attr("stroke-opacity", (d) => (connectedEdges.has(d.id) ? 1 : 0.03));
  }

  private setupKeyboardNav(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Only handle when SVG or body is focused (not input fields)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        this.clearHighlight();
        this.onNodeClick?.(null);
        this.onEdgeClick?.(null);
        return;
      }

      if (this.nodes.length === 0) return;

      if (e.key === "Tab") {
        // Only capture Tab when SVG or its children are focused
        const svgEl = this.svg.node();
        if (!svgEl || !svgEl.contains(document.activeElement)) return;
        e.preventDefault();
        if (this.selectedNodeId) {
          // Cycle through connected nodes
          this.selectNextConnected(e.shiftKey);
        } else {
          // Select first node
          this.selectNodeByIndex(0);
        }
        return;
      }

      if (["ArrowRight", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        this.selectAdjacentNode(1);
        return;
      }
      if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        this.selectAdjacentNode(-1);
        return;
      }

      if (e.key === "Enter" && this.selectedNodeId) {
        // Re-fire the node click to confirm selection
        const node = this.nodes.find((n) => n.id === this.selectedNodeId);
        if (node) {
          this.highlightConnected(node.id);
          const graphNode = this.graphNodeMap.get(node.id);
          if (graphNode) this.onNodeClick?.(graphNode);
        }
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  private selectNodeByIndex(index: number): void {
    const node = this.nodes[index];
    if (!node) return;
    this.selectedNodeId = node.id;
    this.highlightConnected(node.id);
    const graphNode = this.graphNodeMap.get(node.id);
    if (graphNode) this.onNodeClick?.(graphNode);
  }

  private selectAdjacentNode(direction: number): void {
    if (!this.selectedNodeId) {
      this.selectNodeByIndex(0);
      return;
    }
    const currentIdx = this.nodes.findIndex((n) => n.id === this.selectedNodeId);
    const nextIdx = (currentIdx + direction + this.nodes.length) % this.nodes.length;
    this.selectNodeByIndex(nextIdx);
  }

  private selectNextConnected(reverse: boolean): void {
    if (!this.selectedNodeId) return;
    const connected: string[] = [];
    for (const link of this.links) {
      const sourceId =
        typeof link.source === "object" ? (link.source as SimNode).id : String(link.source);
      const targetId =
        typeof link.target === "object" ? (link.target as SimNode).id : String(link.target);
      if (sourceId === this.selectedNodeId) connected.push(targetId);
      if (targetId === this.selectedNodeId) connected.push(sourceId);
    }
    if (connected.length === 0) return;
    const nextId = reverse ? connected[connected.length - 1] : connected[0];
    const nextNodeIdx = this.nodes.findIndex((n) => n.id === nextId);
    if (nextNodeIdx >= 0) this.selectNodeByIndex(nextNodeIdx);
  }

  destroy(): void {
    this.simulation?.stop();
    this.simulation = null;
    if (this.dragEndTimer) {
      clearTimeout(this.dragEndTimer);
      this.dragEndTimer = null;
    }
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    this.svg.selectAll("*").remove();
  }
}
