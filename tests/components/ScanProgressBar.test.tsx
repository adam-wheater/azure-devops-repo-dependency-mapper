import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ScanProgressBar } from "../../src/components/ScanProgressBar";
import { ScanProgress } from "../../src/models/DependencyGraph";

const progress = (overrides: Partial<ScanProgress> = {}): ScanProgress => ({
  phase: "scanning",
  reposTotal: 10,
  reposCompleted: 4,
  currentRepo: "checkout",
  message: "Scanning repositories",
  ...overrides,
});

describe("ScanProgressBar", () => {
  it("renders nothing without progress or once the scan is complete", () => {
    const { container, rerender } = render(<ScanProgressBar progress={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ScanProgressBar progress={progress({ phase: "complete" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the message and the completed count", () => {
    render(<ScanProgressBar progress={progress()} />);

    expect(screen.getByText("Scanning repositories")).toBeInTheDocument();
    expect(screen.getByText("4 / 10")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });

  it("is indeterminate until the repo total is known", () => {
    render(<ScanProgressBar progress={progress({ reposTotal: 0, reposCompleted: 0 })} />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("folds the failed repos behind a toggle", () => {
    render(<ScanProgressBar progress={progress({ failedRepos: ["legacy-api", "old-batch"] })} />);

    expect(screen.queryByText("legacy-api")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 failed" }));
    expect(screen.getByText("legacy-api")).toBeInTheDocument();
    expect(screen.getByText("old-batch")).toBeInTheDocument();
  });
});
