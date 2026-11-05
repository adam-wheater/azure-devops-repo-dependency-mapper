import * as React from "react";
import { CycleGroup, DeploymentTier, DependencyGraph } from "../models/DependencyGraph";
import { LANGUAGE_COLORS } from "../utils/Constants";
import { Language } from "../models/DependencyTypes";
import { Disclosure, Pill } from "./ui";

interface Props {
  graph: DependencyGraph | null;
  expanded: boolean;
  onToggle: () => void;
}

export const DeploymentOrderView: React.FC<Props> = ({ graph, expanded, onToggle }) => {
  const nodeLanguage = React.useMemo(
    () => new Map(graph?.nodes.map((n) => [n.id, n.language]) ?? []),
    [graph?.nodes]
  );

  if (!graph) return null;

  return (
    <div className="ax-section">
      <Disclosure
        open={expanded}
        onToggle={onToggle}
        summary={
          <span className="ax-row">
            <strong>Deployment Order ({graph.deploymentTiers.length} tiers)</strong>
            {graph.cycles.length > 0 && (
              <Pill tone="danger">{graph.cycles.length} circular dependency group(s) detected</Pill>
            )}
          </span>
        }
      >
        <div className="dm-tiers">
          {graph.deploymentTiers.map((tier) => (
            <TierColumn key={tier.tier} tier={tier} nodeLanguage={nodeLanguage} />
          ))}

          {graph.cycles.length > 0 && (
            <div className="dm-cycles">
              <h3 className="dm-cycles__title">Circular Dependencies</h3>
              {graph.cycles.map((cycle, i) => (
                <CycleCard key={i} cycle={cycle} index={i} />
              ))}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
};

const TierColumn: React.FC<{
  tier: DeploymentTier;
  nodeLanguage: Map<string, Language>;
}> = ({ tier, nodeLanguage }) => (
  <div className="dm-tier">
    <div className="dm-tier__head">
      {tier.label}
      <Pill>{tier.repos.length}</Pill>
    </div>
    {tier.repos.map((repo) => (
      <div key={repo} className="dm-repo">
        <span
          className="dm-swatch dm-swatch--dot"
          style={{ background: LANGUAGE_COLORS[nodeLanguage.get(repo) || Language.Unknown] }}
        />
        {repo}
      </div>
    ))}
  </div>
);

const CycleCard: React.FC<{ cycle: CycleGroup; index: number }> = ({ cycle, index }) => (
  <div className="dm-cycle">
    <strong>Cycle {index + 1}</strong>
    <div>{cycle.repos.join(" ↔ ")}</div>
    {cycle.breakSuggestion && (
      <div className="dm-cycle__break">
        <strong>Suggested break:</strong> {cycle.breakSuggestion.edge.source} →{" "}
        {cycle.breakSuggestion.edge.target}
        <div className="ax-fine">{cycle.breakSuggestion.reason}</div>
      </div>
    )}
  </div>
);
