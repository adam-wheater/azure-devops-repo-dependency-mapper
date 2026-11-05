import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Confidence, DependencyType, Language } from "../../src/models/DependencyTypes";

// d3 ships as ES modules, which Jest does not transform, and the force layout needs a
// real layout engine anyway. The graph itself is exercised in the browser.
jest.mock("../../src/visualization/ForceGraph", () => ({
  ForceGraph: (props: { graph: { nodes: unknown[] } | null }) => (
    <div data-testid="force-graph">
      {props.graph ? `${props.graph.nodes.length} nodes` : "empty"}
    </div>
  ),
}));

const mockScan = jest.fn();
jest.mock("../../src/scanning/ScanOrchestrator", () => ({
  ScanOrchestrator: jest.fn().mockImplementation(() => ({ scan: mockScan })),
}));

import { App } from "../../src/components/App";

const scanResult = {
  dependencies: [
    {
      sourceRepo: "checkout",
      targetRepo: "shared-lib",
      type: DependencyType.NuGet,
      confidence: Confidence.High,
      detail: 'PackageReference "Fabrikam.Shared" v1.0.0',
      sourceFile: "/src/Checkout.csproj",
      version: "1.0.0",
    },
  ],
  repoLanguages: new Map([
    ["checkout", Language.CSharp],
    ["shared-lib", Language.CSharp],
    ["docs", Language.Unknown],
  ]),
  repoUrls: new Map<string, string>(),
  infraResources: [],
  allRepoNames: ["checkout", "shared-lib", "docs"],
  repoMetadata: new Map(),
};

beforeEach(() => {
  mockScan.mockReset();
  window.localStorage.clear();
});

describe("App", () => {
  it("renders the shell with the scan actions and no results yet", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Repository Dependency Mapper" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan all repos" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Full rescan" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByTestId("force-graph")).toHaveTextContent("empty");
    expect(screen.queryByText("Repositories")).toBeNull();
  });

  it("scans, then shows the summary tiles, the graph and the deployment order", async () => {
    mockScan.mockResolvedValue(scanResult);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Scan all repos" }));

    await waitFor(() => expect(screen.getByTestId("force-graph")).toHaveTextContent("3 nodes"));
    expect(mockScan).toHaveBeenCalledWith(false);
    expect(screen.getByText("Repositories")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText(/Deployment Order \(\d+ tiers?\)/)).toBeInTheDocument();
  });

  it("passes force through for a full rescan", async () => {
    mockScan.mockResolvedValue(scanResult);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Full rescan" }));

    await waitFor(() => expect(mockScan).toHaveBeenCalledWith(true));
  });

  it("shows a dismissible error banner when the scan fails", async () => {
    mockScan.mockRejectedValue(new Error("boom"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Scan all repos" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Scan failed: boom");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the shortcuts dialog from the question mark key and closes it", () => {
    render(<App />);

    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the path finder only after a scan", async () => {
    mockScan.mockResolvedValue(scanResult);
    render(<App />);
    expect(screen.queryByRole("button", { name: "Find path" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Scan all repos" }));
    const toggle = await screen.findByRole("button", { name: "Find path" });

    fireEvent.click(toggle);
    expect(screen.getByRole("heading", { name: "Find a path" })).toBeInTheDocument();
  });
});
