import * as React from "react";
import { DependencyGraph, GraphEdge, GraphNode, ServiceInstance } from "../models/DependencyGraph";
import { InfraResource } from "../scanning/detectors/InfraDetector";
import { DEPENDENCY_COLORS, LANGUAGE_COLORS } from "../utils/Constants";
import { analyzeImpact, ImpactResult } from "../analysis/ImpactAnalysis";
import { Button, EmptyState, IconCopy, IconExternal } from "./ui";

interface Props {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  infraResources: InfraResource[];
  allEdges: GraphEdge[];
  onPinToggle: (nodeId: string) => void;
  pinnedNodes: Set<string>;
  graph: DependencyGraph | null;
  onNodeClick?: (node: GraphNode | null) => void;
}

const DetailPanelInner: React.FC<Props> = ({
  selectedNode,
  selectedEdge,
  infraResources,
  allEdges,
  onPinToggle,
  pinnedNodes,
  graph,
  onNodeClick,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [showImpact, setShowImpact] = React.useState(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Reset impact view when selected node changes
  React.useEffect(() => {
    setShowImpact(false);
  }, [selectedNode?.id]);

  const navigateToNode = React.useCallback(
    (nodeId: string) => {
      if (!graph || !onNodeClick) return;
      const target = graph.nodes.find((n) => n.id === nodeId || n.name === nodeId);
      if (target) onNodeClick(target);
    },
    [graph, onNodeClick]
  );

  const impact: ImpactResult | null = React.useMemo(() => {
    if (!selectedNode || !graph || !showImpact) return null;
    return analyzeImpact(graph, selectedNode.id);
  }, [selectedNode, graph, showImpact]);

  const handleCopy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard API may be unavailable in some contexts
      });
  };
  if (!selectedNode && !selectedEdge) {
    return (
      <section className="ax-card dm-details" aria-label="Details">
        <EmptyState title="Click a node or edge to view details" />
      </section>
    );
  }

  if (selectedNode) {
    const nodeId = selectedNode.id;
    const nodeName = selectedNode.name;
    const inbound = allEdges.filter((e) => e.target === nodeId);
    const outbound = allEdges.filter((e) => e.source === nodeId);
    const nodeInfra = infraResources.filter((r) => r.repo === nodeName || r.repo === nodeId);
    const pinned = pinnedNodes.has(selectedNode.id);

    const edgeList = (edges: GraphEdge[], pick: (e: GraphEdge) => string) => (
      <ul className="dm-list">
        {edges.map((e) => (
          <li key={e.id}>
            <span
              className="dm-swatch"
              style={{ background: DEPENDENCY_COLORS[e.type], marginRight: 6 }}
            />
            <button
              type="button"
              onClick={() => navigateToNode(pick(e))}
              className="dm-link-button"
              title={`Select ${pick(e)}`}
            >
              {pick(e)}
            </button>{" "}
            <span className="ax-muted">({e.type})</span>
          </li>
        ))}
      </ul>
    );

    return (
      <section className="ax-card dm-details" aria-label="Details">
        <header className="ax-card__head">
          <h2 className="ax-card__title dm-node-title">
            <span
              className="dm-swatch dm-swatch--dot"
              style={{ background: LANGUAGE_COLORS[selectedNode.language] }}
            />
            {selectedNode.name}
          </h2>
          <div className="ax-row">
            <Button
              size="sm"
              icon={<IconCopy />}
              onClick={() => handleCopy(selectedNode.name)}
              title="Copy repo name"
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant={pinned ? "primary" : "default"}
              aria-pressed={pinned}
              onClick={() => onPinToggle(selectedNode.id)}
              title={pinned ? "Unpin node" : "Pin node position"}
            >
              {pinned ? "Unpin" : "Pin"}
            </Button>
          </div>
        </header>
        <div className="ax-card__body">
          {selectedNode.url && (
            <p style={{ margin: "0 0 var(--ax-s2)" }}>
              <a
                className="ax-link"
                href={selectedNode.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Azure DevOps <IconExternal />
              </a>
            </p>
          )}
          <dl className="ax-kv">
            <dt>Language</dt>
            <dd>{selectedNode.language}</dd>
            <dt>Depended on by</dt>
            <dd>{selectedNode.inDegree}</dd>
            <dt>Depends on</dt>
            <dd>{selectedNode.outDegree}</dd>
          </dl>

          <div style={{ marginTop: "var(--ax-s3)" }}>
            <Button
              size="sm"
              variant={showImpact ? "primary" : "default"}
              aria-pressed={showImpact}
              onClick={() => setShowImpact(!showImpact)}
            >
              {showImpact ? "Hide Impact" : "Analyze Impact"}
            </Button>
          </div>
          {impact && (
            <div className="dm-note">
              <dl className="ax-kv">
                <dt>Blast radius</dt>
                <dd>{impact.blastRadius} repos</dd>
                <dt>Direct dependents</dt>
                <dd>{impact.directDependents.length}</dd>
                <dt>Transitive</dt>
                <dd>{impact.transitiveDependents.length}</dd>
                {impact.affectedTiers.length > 0 && (
                  <>
                    <dt>Affected tiers</dt>
                    <dd>{impact.affectedTiers.join(", ")}</dd>
                  </>
                )}
              </dl>
              {impact.criticalPath.length > 1 && (
                <p className="ax-fine" style={{ margin: "var(--ax-s2) 0 0" }}>
                  <strong>Longest chain:</strong> {impact.criticalPath.join(" -> ")}
                </p>
              )}
            </div>
          )}

          {nodeInfra.length > 0 && (
            <>
              <h3 className="dm-side-title">Azure Resources Deployed</h3>
              <ul className="dm-list">
                {nodeInfra.map((r) => (
                  <li key={`${r.repo}-${r.resourceType}-${r.resourceName}`}>
                    <strong>{r.resourceType}</strong>: {r.resourceName}
                    <div className="dm-list__meta">{r.sourceFile}</div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {selectedNode.consumedServices && selectedNode.consumedServices.length > 0 && (
            <>
              <h3 className="dm-side-title">Services Used</h3>
              <ul className="dm-list">
                {deduplicateServices(selectedNode.consumedServices).map((svc) => (
                  <li key={`${svc.serviceType}-${svc.instanceId}-${svc.detectedFrom}`}>
                    <strong>{svc.serviceType}</strong>
                    {svc.instanceId && <span>: {svc.instanceId}</span>}
                    <div className="dm-list__meta">via {svc.detectedFrom}</div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {selectedNode.databases && selectedNode.databases.length > 0 && (
            <>
              <h3 className="dm-side-title">Databases</h3>
              <ul className="dm-list">
                {selectedNode.databases.map((db) => (
                  <li key={db}>{db}</li>
                ))}
              </ul>
            </>
          )}

          {selectedNode.publishedPackages && selectedNode.publishedPackages.length > 0 && (
            <>
              <h3 className="dm-side-title">Published Packages</h3>
              <ul className="dm-list">
                {selectedNode.publishedPackages.map((pkg) => (
                  <li key={pkg}>{pkg}</li>
                ))}
              </ul>
            </>
          )}

          {selectedNode.consumedPackages && selectedNode.consumedPackages.length > 0 && (
            <>
              <h3 className="dm-side-title">Consumed Packages (internal)</h3>
              <ul className="dm-list">
                {selectedNode.consumedPackages.map((pkg) => (
                  <li key={pkg}>{pkg}</li>
                ))}
              </ul>
            </>
          )}

          {inbound.length > 0 && (
            <>
              <h3 className="dm-side-title">Depended On By ({inbound.length})</h3>
              {edgeList(inbound, (e) => e.source)}
            </>
          )}

          {outbound.length > 0 && (
            <>
              <h3 className="dm-side-title">Depends On ({outbound.length})</h3>
              {edgeList(outbound, (e) => e.target)}
            </>
          )}
        </div>
      </section>
    );
  }

  if (selectedEdge) {
    return (
      <section className="ax-card dm-details" aria-label="Details">
        <header className="ax-card__head">
          <h2 className="ax-card__title dm-node-title">
            {selectedEdge.source} → {selectedEdge.target}
          </h2>
        </header>
        <div className="ax-card__body">
          <div className="ax-row">
            <span className="ax-pill ax-pill--neutral">
              <span
                className="dm-swatch"
                style={{ background: DEPENDENCY_COLORS[selectedEdge.type] }}
              />
              {selectedEdge.type}
            </span>
            <span className="ax-muted">Confidence: {selectedEdge.confidence}</span>
          </div>
          <h3 className="dm-side-title">Details ({selectedEdge.details.length})</h3>
          <ul className="dm-list">
            {selectedEdge.details.map((d) => (
              <li key={`${d.sourceFile}-${d.description.slice(0, 60)}`}>
                <div>{d.description}</div>
                {d.version && <div className="dm-list__meta">v{d.version}</div>}
                {d.sourceFile && <div className="dm-list__meta">{d.sourceFile}</div>}
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return null;
};

function deduplicateServices(services: ServiceInstance[]): ServiceInstance[] {
  const seen = new Set<string>();
  return services.filter((s) => {
    const key = `${s.serviceType}:${s.instanceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const DetailPanel = React.memo(DetailPanelInner);
