import * as React from "react";
import { DEPENDENCY_COLORS, LANGUAGE_COLORS } from "../utils/Constants";
import { DependencyType, Language } from "../models/DependencyTypes";
import { Button } from "../components/ui";

const typeLabels: Record<DependencyType, string> = {
  [DependencyType.NuGet]: "NuGet Package",
  [DependencyType.API]: "API Call",
  [DependencyType.Database]: "Shared Database",
  [DependencyType.GoModule]: "Go Module",
  [DependencyType.Infrastructure]: "Infrastructure",
  [DependencyType.Npm]: "npm Package",
  [DependencyType.Docker]: "Docker Image",
  [DependencyType.Maven]: "Maven/Gradle",
  [DependencyType.Python]: "Python Package",
  [DependencyType.Helm]: "Helm Chart",
  [DependencyType.AppConfig]: "App Config",
  [DependencyType.ServiceUsage]: "Shared Service",
  [DependencyType.ServiceBus]: "Service Bus",
  [DependencyType.ServiceConnection]: "Service Connection",
};

const langLabels: Record<Language, string> = {
  [Language.CSharp]: "C#",
  [Language.Go]: "Go",
  [Language.TypeScript]: "TypeScript",
  [Language.Java]: "Java",
  [Language.Python]: "Python",
  [Language.Unknown]: "Unknown",
};

export const GraphLegend: React.FC = React.memo(() => {
  const [open, setOpen] = React.useState(true);

  return (
    <div className="dm-legend" role="group" aria-label="Graph legend">
      <div className="dm-legend__head">
        Legend
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          title={open ? "Hide the legend" : "Show the legend"}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <div className="dm-legend__cols">
          <div>
            <h3 className="dm-legend__title">Edges</h3>
            <div className="dm-legend__edges">
              {Object.entries(DEPENDENCY_COLORS).map(([type, color]) => (
                <div key={type} className="dm-legend__item">
                  <span className="dm-legend__line" style={{ background: color }} />
                  <span>{typeLabels[type as DependencyType] || type}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="dm-legend__title">Nodes</h3>
            <div className="dm-legend__nodes">
              {Object.entries(LANGUAGE_COLORS).map(([lang, color]) => (
                <div key={lang} className="dm-legend__item">
                  <span className="dm-swatch dm-swatch--dot" style={{ background: color }} />
                  <span>{langLabels[lang as Language] || lang}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
