import * as React from "react";
import { DependencyGraph } from "../models/DependencyGraph";
import { Button, Card, IconDownload, IconSearch } from "./ui";

interface Props {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  graph: DependencyGraph | null;
  reverseSearch: boolean;
  onReverseSearchToggle: () => void;
  onTogglePathFinder: () => void;
  showPathFinder: boolean;
}

export const ControlBar: React.FC<Props> = ({
  searchTerm,
  onSearchChange,
  graph,
  reverseSearch,
  onReverseSearchToggle,
  onTogglePathFinder,
  showPathFinder,
}) => {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [localSearch, setLocalSearch] = React.useState(searchTerm);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when parent clears search (e.g. Escape key)
  React.useEffect(() => {
    if (searchTerm === "" && localSearch !== "") {
      setLocalSearch("");
    }
  }, [searchTerm]);

  const handleSearchInput = React.useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onSearchChange(value), 300);
    },
    [onSearchChange]
  );

  // Cleanup debounce timer on unmount
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Global keyboard shortcut: "/" focuses search
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        searchRef.current?.blur();
        setLocalSearch("");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onSearchChange("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onSearchChange]);

  const handleExport = (format: "json" | "svg" | "csv-nodes" | "csv-edges") => {
    if (!graph) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (format === "json") {
      const blob = new Blob([JSON.stringify(graph, null, 2)], {
        type: "application/json",
      });
      downloadBlob(blob, `dependency-graph-${ts}.json`);
    } else if (format === "svg") {
      const svgEl = document.querySelector('svg[role="img"]');
      if (svgEl) {
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        inlineStyles(svgEl, clone);
        if (!clone.getAttribute("xmlns")) {
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        }
        const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
        downloadBlob(blob, `dependency-graph-${ts}.svg`);
      }
    } else if (format === "csv-nodes") {
      const header = "name,language,inDegree,outDegree,tier\n";
      const tierMap = new Map<string, number>();
      for (const t of graph.deploymentTiers) {
        for (const r of t.repos) tierMap.set(r, t.tier);
      }
      const rows = graph.nodes
        .map((n) =>
          [n.name, n.language, n.inDegree, n.outDegree, tierMap.get(n.id) ?? ""]
            .map(escapeCSV)
            .join(",")
        )
        .join("\n");
      const blob = new Blob([header + rows], { type: "text/csv" });
      downloadBlob(blob, `dependency-nodes-${ts}.csv`);
    } else if (format === "csv-edges") {
      const header = "source,target,type,confidence,weight,detail\n";
      const rows = graph.edges
        .map((e) =>
          [
            e.source,
            e.target,
            e.type,
            e.confidence,
            e.weight,
            e.details.map((d) => d.description).join("; "),
          ]
            .map(escapeCSV)
            .join(",")
        )
        .join("\n");
      const blob = new Blob([header + rows], { type: "text/csv" });
      downloadBlob(blob, `dependency-edges-${ts}.csv`);
    }
  };

  return (
    <Card className="dm-toolbar-card">
      <div className="ax-toolbar">
        <label className="ax-search">
          <span className="ax-search__icon">
            <IconSearch />
          </span>
          <input
            ref={searchRef}
            type="text"
            className="ax-input"
            aria-label={reverseSearch ? "Search for dependents" : "Search repositories"}
            placeholder={reverseSearch ? "What depends on...  (/)" : "Search repos...  (/)"}
            value={localSearch}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </label>
        <Button
          variant={reverseSearch ? "primary" : "default"}
          aria-pressed={reverseSearch}
          onClick={onReverseSearchToggle}
          title="Reverse search: show what depends on the searched repo"
        >
          Dependents
        </Button>
        {graph && (
          <Button
            variant={showPathFinder ? "primary" : "default"}
            aria-pressed={showPathFinder}
            onClick={onTogglePathFinder}
            title="Find dependency paths between repositories"
          >
            Find path
          </Button>
        )}
        <div className="ax-spacer" />
        {graph && (
          <div className="ax-toolbar__group" role="group" aria-label="Export">
            <Button size="sm" icon={<IconDownload />} onClick={() => handleExport("json")}>
              JSON
            </Button>
            <Button size="sm" icon={<IconDownload />} onClick={() => handleExport("svg")}>
              SVG
            </Button>
            <Button size="sm" icon={<IconDownload />} onClick={() => handleExport("csv-nodes")}>
              CSV nodes
            </Button>
            <Button size="sm" icon={<IconDownload />} onClick={() => handleExport("csv-edges")}>
              CSV edges
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};

function escapeCSV(value: string | number): string {
  let s = String(value);
  // Prevent CSV formula injection
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function inlineStyles(source: Element, target: Element): void {
  const computed = window.getComputedStyle(source);
  const important = [
    "fill",
    "stroke",
    "stroke-width",
    "font-family",
    "font-size",
    "font-weight",
    "opacity",
    "text-anchor",
    "dominant-baseline",
  ];
  for (const prop of important) {
    const val = computed.getPropertyValue(prop);
    if (val) {
      (target as SVGElement | HTMLElement).style.setProperty(prop, val);
    }
  }
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length; i++) {
    if (targetChildren[i]) {
      inlineStyles(sourceChildren[i], targetChildren[i]);
    }
  }
}
