import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeploymentOrderView } from "../../src/components/DeploymentOrderView";
import { DependencyGraph } from "../../src/models/DependencyGraph";
import { Language, DependencyType, Confidence } from "../../src/models/DependencyTypes";

function makeGraph(overrides: Partial<DependencyGraph> = {}): DependencyGraph {
  return {
    nodes: [
      {
        id: "base-lib",
        name: "base-lib",
        language: Language.CSharp,
        url: "",
        inDegree: 0,
        outDegree: 1,
        databases: [],
        publishedPackages: [],
        consumedPackages: [],
        consumedServices: [],
      },
      {
        id: "api-service",
        name: "api-service",
        language: Language.Go,
        url: "",
        inDegree: 1,
        outDegree: 0,
        databases: [],
        publishedPackages: [],
        consumedPackages: [],
        consumedServices: [],
      },
    ],
    edges: [
      {
        id: "base-lib->api-service:nuget",
        source: "base-lib",
        target: "api-service",
        type: DependencyType.NuGet,
        confidence: Confidence.High,
        details: [],
        weight: 1,
      },
    ],
    deploymentTiers: [
      { tier: 0, label: "Tier 0 - Deploy First (no dependencies)", repos: ["base-lib"] },
      { tier: 1, label: "Tier 1 - Deploy Last", repos: ["api-service"] },
    ],
    cycles: [],
    stats: {
      totalRepos: 2,
      totalEdges: 1,
      isolatedRepos: 0,
      maxDepth: 2,
      cycleCount: 0,
      scanDurationMs: 100,
      graphDensity: 0.5,
      avgDegree: 1,
      typeBreakdown: {},
    },
    ...overrides,
  };
}

describe("DeploymentOrderView", () => {
  test("renders nothing when graph is null", () => {
    const { container } = render(
      <DeploymentOrderView graph={null} expanded={false} onToggle={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("shows deployment tier count in collapsed state", () => {
    const graph = makeGraph();
    render(<DeploymentOrderView graph={graph} expanded={false} onToggle={jest.fn()} />);

    expect(screen.getByText(/Deployment Order \(2 tiers\)/)).toBeTruthy();
  });

  test("expands to show tier details", () => {
    const graph = makeGraph();
    render(<DeploymentOrderView graph={graph} expanded={true} onToggle={jest.fn()} />);

    expect(screen.getByText("base-lib")).toBeTruthy();
    expect(screen.getByText("api-service")).toBeTruthy();
  });

  test("toggle calls onToggle handler", () => {
    const graph = makeGraph();
    const onToggle = jest.fn();
    render(<DeploymentOrderView graph={graph} expanded={false} onToggle={onToggle} />);

    const toggleBtn = screen.getByRole("button");
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("shows cycle warning when cycles exist", () => {
    const graph = makeGraph({
      cycles: [
        {
          repos: ["A", "B"],
          edges: [],
          breakSuggestion: {
            edge: {
              id: "A->B:nuget",
              source: "A",
              target: "B",
              type: DependencyType.NuGet,
              confidence: Confidence.Low,
              details: [],
              weight: 1,
            },
            reason: "Lowest confidence",
          },
        },
      ],
    });

    render(<DeploymentOrderView graph={graph} expanded={true} onToggle={jest.fn()} />);

    expect(screen.getByText(/1 circular dependency group/)).toBeTruthy();
    expect(screen.getByText("Circular Dependencies")).toBeTruthy();
  });

  test("the toggle is a native button that reports its expanded state", () => {
    const graph = makeGraph();
    const { rerender } = render(
      <DeploymentOrderView graph={graph} expanded={false} onToggle={jest.fn()} />
    );

    // A real <button> handles Enter and Space itself, so no key handler is needed.
    const toggleBtn = screen.getByRole("button");
    expect(toggleBtn.tagName).toBe("BUTTON");
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("base-lib")).toBeNull();

    rerender(<DeploymentOrderView graph={graph} expanded={true} onToggle={jest.fn()} />);
    expect(
      screen.getByRole("button", { name: /Deployment Order/ }).getAttribute("aria-expanded")
    ).toBe("true");
  });

  test("shows the suggested break for a cycle", () => {
    const edge = {
      id: "A->B:nuget",
      source: "A",
      target: "B",
      type: DependencyType.NuGet,
      confidence: Confidence.Low,
      details: [],
      weight: 1,
    };
    const graph = makeGraph({
      cycles: [
        {
          repos: ["A", "B"],
          edges: [edge],
          breakSuggestion: { edge, reason: "Lowest confidence" },
        },
      ],
    });

    render(<DeploymentOrderView graph={graph} expanded={true} onToggle={jest.fn()} />);

    expect(screen.getByText("Cycle 1")).toBeTruthy();
    expect(screen.getByText("Lowest confidence")).toBeTruthy();
  });
});
