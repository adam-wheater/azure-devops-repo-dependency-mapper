import * as React from "react";
import { DependencyGraph } from "../models/DependencyGraph";
import { findAllPaths, findShortestPath } from "../analysis/PathFinder";
import { Button, Card, IconChevronRight, Pill } from "./ui";

interface Props {
  graph: DependencyGraph;
  pathSource: string;
  pathTarget: string;
  pathResults: string[][] | null;
  onSourceChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onPathResults: (results: string[][] | null) => void;
}

export const PathFinderPanel: React.FC<Props> = ({
  graph,
  pathSource,
  pathTarget,
  pathResults,
  onSourceChange,
  onTargetChange,
  onPathResults,
}) => {
  const [searching, setSearching] = React.useState(false);

  const nodeIds = React.useMemo(() => graph.nodes.map((n) => n.id).sort(), [graph.nodes]);

  const nodeNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graph.nodes) {
      map.set(n.id, n.name);
    }
    return map;
  }, [graph.nodes]);

  const displayName = (id: string) => nodeNameMap.get(id) || id;

  const handleFindShortest = () => {
    if (!pathSource || !pathTarget) return;
    setSearching(true);
    setTimeout(() => {
      const result = findShortestPath(graph, pathSource, pathTarget);
      onPathResults(result ? [result] : []);
      setSearching(false);
    }, 0);
  };

  const handleFindAll = () => {
    if (!pathSource || !pathTarget) return;
    setSearching(true);
    setTimeout(() => {
      const results = findAllPaths(graph, pathSource, pathTarget);
      onPathResults(results);
      setSearching(false);
    }, 0);
  };

  const canSearch = pathSource !== "" && pathTarget !== "" && pathSource !== pathTarget;

  const repoSelect = (
    label: string,
    ariaLabel: string,
    value: string,
    onChange: (value: string) => void
  ) => (
    <label className="dm-path-field">
      <span>{label}</span>
      <select
        className="ax-select"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onPathResults(null);
        }}
        aria-label={ariaLabel}
      >
        <option value="">-- select --</option>
        {nodeIds.map((id) => (
          <option key={id} value={id}>
            {displayName(id)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card
      title="Find a path"
      hint="Trace how one repository reaches another through detected dependencies"
    >
      <div className="ax-toolbar" style={{ marginBottom: 0 }}>
        {repoSelect("Source", "Path source repository", pathSource, onSourceChange)}
        {repoSelect("Target", "Path target repository", pathTarget, onTargetChange)}
        <Button
          variant="primary"
          onClick={handleFindShortest}
          disabled={!canSearch}
          title="Find the shortest dependency path between source and target"
        >
          Find shortest path
        </Button>
        <Button
          onClick={handleFindAll}
          disabled={!canSearch}
          title="Find all dependency paths between source and target"
        >
          Find all paths
        </Button>
        {pathResults !== null && (
          <Button variant="ghost" onClick={() => onPathResults(null)}>
            Clear
          </Button>
        )}
      </div>

      {searching && (
        <p className="ax-muted" role="status" style={{ margin: "var(--ax-s3) 0 0" }}>
          Searching...
        </p>
      )}

      {pathResults !== null && !searching && (
        <div style={{ marginTop: "var(--ax-s3)" }}>
          {pathResults.length === 0 ? (
            <p className="ax-muted" style={{ margin: 0 }}>
              No path found from {displayName(pathSource)} to {displayName(pathTarget)}.
            </p>
          ) : (
            <>
              <Pill tone="info">
                {pathResults.length} path{pathResults.length !== 1 ? "s" : ""} found
              </Pill>
              <div className="dm-paths">
                {pathResults.map((path, idx) => (
                  <div key={idx} className="dm-path">
                    {path.map((nodeId, nIdx) => (
                      <React.Fragment key={nodeId + "-" + nIdx}>
                        <span
                          className={nIdx === 0 || nIdx === path.length - 1 ? "dm-path__end" : ""}
                        >
                          {displayName(nodeId)}
                        </span>
                        {nIdx < path.length - 1 && <IconChevronRight size={12} />}
                      </React.Fragment>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
};
