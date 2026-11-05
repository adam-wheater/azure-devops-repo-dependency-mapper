import * as React from "react";
import { DependencyType, Confidence, Language } from "../models/DependencyTypes";
import { DependencyGraph } from "../models/DependencyGraph";
import { DEPENDENCY_COLORS, LANGUAGE_COLORS } from "../utils/Constants";
import { Button, IconChevronRight } from "./ui";

const typeLabels: Record<DependencyType, string> = {
  [DependencyType.NuGet]: "NuGet",
  [DependencyType.API]: "API",
  [DependencyType.Database]: "Database",
  [DependencyType.GoModule]: "Go Module",
  [DependencyType.Infrastructure]: "Infrastructure",
  [DependencyType.Npm]: "npm",
  [DependencyType.Docker]: "Docker",
  [DependencyType.Maven]: "Maven/Gradle",
  [DependencyType.Python]: "Python",
  [DependencyType.Helm]: "Helm",
  [DependencyType.AppConfig]: "App Config",
  [DependencyType.ServiceUsage]: "Shared Service",
  [DependencyType.ServiceBus]: "Service Bus",
  [DependencyType.ServiceConnection]: "Service Connection",
};

const languageLabels: Record<Language, string> = {
  [Language.CSharp]: "C#",
  [Language.Go]: "Go",
  [Language.TypeScript]: "TypeScript",
  [Language.Java]: "Java",
  [Language.Python]: "Python",
  [Language.Unknown]: "Unknown",
};

export interface FilterState {
  types: Set<DependencyType>;
  repos: Set<string>;
  minConfidence: Confidence;
  showIsolated: boolean;
  repoFilterActive: boolean;
  languages: Set<string>;
}

interface Props {
  graph: DependencyGraph | null;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export const FilterPanel: React.FC<Props> = ({ graph, filters, onChange }) => {
  const [repoSearch, setRepoSearch] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);

  const toggleType = (type: DependencyType) => {
    const next = new Set(filters.types);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filters, types: next });
  };

  const toggleLanguage = (lang: string) => {
    const next = new Set(filters.languages);
    if (next.has(lang)) {
      next.delete(lang);
    } else {
      next.add(lang);
    }
    onChange({ ...filters, languages: next });
  };

  const toggleRepo = (repo: string) => {
    const next = new Set(filters.repos);
    if (next.has(repo)) {
      next.delete(repo);
    } else {
      next.add(repo);
    }
    const allSelected = allRepos.length > 0 && next.size === allRepos.length;
    onChange({ ...filters, repos: next, repoFilterActive: !allSelected });
  };

  const selectAllTypes = () =>
    onChange({ ...filters, types: new Set(Object.values(DependencyType)) });
  const selectNoTypes = () => onChange({ ...filters, types: new Set() });
  const selectAllLanguages = () =>
    onChange({ ...filters, languages: new Set(Object.values(Language)) });
  const selectNoLanguages = () => onChange({ ...filters, languages: new Set() });
  const selectAllRepos = () =>
    onChange({ ...filters, repos: new Set(allRepos), repoFilterActive: false });
  const selectNoRepos = () => onChange({ ...filters, repos: new Set(), repoFilterActive: true });

  const allRepos = React.useMemo(
    () => graph?.nodes.map((n) => n.name).sort() || [],
    [graph?.nodes]
  );

  const visibleRepos = React.useMemo(() => {
    if (!repoSearch) return allRepos;
    const lower = repoSearch.toLowerCase();
    return allRepos.filter((r) => r.toLowerCase().includes(lower));
  }, [allRepos, repoSearch]);

  if (collapsed) {
    return (
      <section
        className="ax-card dm-filters dm-filters--collapsed"
        role="region"
        aria-label="Filter panel"
      >
        <div style={{ padding: "var(--ax-s2)" }}>
          <Button
            variant="ghost"
            className="ax-btn--icon"
            onClick={() => setCollapsed(false)}
            title="Expand filters"
            aria-label="Expand filters"
            icon={<IconChevronRight />}
          />
        </div>
      </section>
    );
  }

  const allNone = (onAll: () => void, onNone: () => void, label: string) => (
    <span className="ax-row" style={{ gap: 0 }}>
      <Button variant="ghost" size="sm" onClick={onAll} aria-label={`Select all ${label}`}>
        All
      </Button>
      <Button variant="ghost" size="sm" onClick={onNone} aria-label={`Select no ${label}`}>
        None
      </Button>
    </span>
  );

  return (
    <section className="ax-card dm-filters" role="region" aria-label="Filter panel">
      <header className="ax-card__head">
        <h2 className="ax-card__title">Filters</h2>
        <Button
          variant="ghost"
          size="sm"
          className="ax-btn--icon"
          onClick={() => setCollapsed(true)}
          title="Collapse filters"
          aria-label="Collapse filters"
          icon={<IconChevronRight className="dm-flip" />}
        />
      </header>
      <div className="ax-card__body">
        <div className="dm-group-head">
          <h3>Dependency type</h3>
          {allNone(selectAllTypes, selectNoTypes, "dependency types")}
        </div>
        <div className="dm-check-list">
          {Object.values(DependencyType).map((type) => (
            <label key={type} className="ax-check">
              <input
                type="checkbox"
                checked={filters.types.has(type)}
                onChange={() => toggleType(type)}
              />
              <span className="dm-swatch" style={{ background: DEPENDENCY_COLORS[type] }} />
              {typeLabels[type]}
            </label>
          ))}
        </div>

        <div className="dm-group-head">
          <h3>Confidence</h3>
        </div>
        <select
          className="ax-select"
          style={{ width: "100%" }}
          value={filters.minConfidence}
          onChange={(e) => onChange({ ...filters, minConfidence: e.target.value as Confidence })}
          aria-label="Minimum confidence level"
        >
          <option value={Confidence.Low}>Low+</option>
          <option value={Confidence.Medium}>Medium+</option>
          <option value={Confidence.High}>High only</option>
        </select>

        <label className="ax-check" style={{ marginTop: "var(--ax-s3)" }}>
          <input
            type="checkbox"
            checked={filters.showIsolated}
            onChange={(e) => onChange({ ...filters, showIsolated: e.target.checked })}
          />
          Show isolated repos
        </label>

        <div className="dm-group-head">
          <h3>Languages</h3>
          {allNone(selectAllLanguages, selectNoLanguages, "languages")}
        </div>
        <div className="dm-check-list">
          {Object.values(Language).map((lang) => (
            <label key={lang} className="ax-check">
              <input
                type="checkbox"
                checked={filters.languages.has(lang)}
                onChange={() => toggleLanguage(lang)}
              />
              <span
                className="dm-swatch dm-swatch--dot"
                style={{ background: LANGUAGE_COLORS[lang as Language] }}
              />
              {languageLabels[lang as Language] || lang}
            </label>
          ))}
        </div>

        <div className="dm-group-head">
          <h3>Repositories ({allRepos.length})</h3>
          {allNone(selectAllRepos, selectNoRepos, "repositories")}
        </div>
        <input
          type="text"
          className="ax-input ax-input--sm"
          style={{ width: "100%", marginBottom: "var(--ax-s2)" }}
          placeholder="Filter repos..."
          aria-label="Filter repositories by name"
          value={repoSearch}
          onChange={(e) => setRepoSearch(e.target.value)}
        />
        <div className="dm-check-list dm-check-list--scroll">
          {visibleRepos.map((repo) => (
            <label key={repo} className="ax-check">
              <input
                type="checkbox"
                checked={filters.repos.has(repo)}
                onChange={() => toggleRepo(repo)}
              />
              {repo}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
};

export function applyFilters(graph: DependencyGraph, filters: FilterState): DependencyGraph {
  const hasRepoFilter = filters.repoFilterActive;

  const filteredEdges = graph.edges.filter((e) => {
    if (!filters.types.has(e.type)) return false;
    if (filters.minConfidence === Confidence.High && e.confidence !== Confidence.High) return false;
    if (filters.minConfidence === Confidence.Medium && e.confidence === Confidence.Low)
      return false;
    if (hasRepoFilter) {
      if (!filters.repos.has(e.source) && !filters.repos.has(e.target)) return false;
    }
    return true;
  });

  const connectedNodes = new Set<string>();
  for (const e of filteredEdges) {
    connectedNodes.add(e.source);
    connectedNodes.add(e.target);
  }

  const hasLanguageFilter = filters.languages.size < Object.values(Language).length;

  const filteredNodes = graph.nodes.filter((n) => {
    // Filter by language if not all selected
    if (hasLanguageFilter && !filters.languages.has(n.language)) return false;
    // Node is connected by a visible edge — always show
    if (connectedNodes.has(n.id)) return true;
    // Isolated node: show only when "Show isolated" is on
    if (!filters.showIsolated) return false;
    // When specific repos are selected, only show those repos as isolated
    if (hasRepoFilter) return filters.repos.has(n.id);
    return true;
  });

  return {
    ...graph,
    nodes: filteredNodes,
    edges: filteredEdges,
    stats: {
      ...graph.stats,
      totalRepos: filteredNodes.length,
      totalEdges: filteredEdges.length,
    },
  };
}
