import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GraphLegend } from "../../src/visualization/GraphLegend";
import { DependencyType, Language } from "../../src/models/DependencyTypes";

describe("GraphLegend", () => {
  it("lists every dependency type and language", () => {
    const { container } = render(<GraphLegend />);

    expect(container.querySelectorAll(".dm-legend__line")).toHaveLength(
      Object.values(DependencyType).length
    );
    expect(container.querySelectorAll(".dm-swatch--dot")).toHaveLength(
      Object.values(Language).length
    );
    expect(screen.getByText("NuGet Package")).toBeInTheDocument();
    expect(screen.getByText("C#")).toBeInTheDocument();
  });

  it("takes its colours from theme variables, not hex values", () => {
    const { container } = render(<GraphLegend />);
    const line = container.querySelector<HTMLElement>(".dm-legend__line");

    expect(line?.style.background).toMatch(/^var\(--dm-edge-/);
  });

  it("hides and shows the key", () => {
    render(<GraphLegend />);

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("NuGet Package")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("NuGet Package")).toBeInTheDocument();
  });
});
