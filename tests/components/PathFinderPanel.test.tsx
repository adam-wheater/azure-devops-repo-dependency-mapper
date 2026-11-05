import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PathFinderPanel } from "../../src/components/PathFinderPanel";
import { makeEdge, makeGraph, makeNode } from "./fixtures";

const graph = makeGraph(
  [makeNode("web"), makeNode("api"), makeNode("shared-lib")],
  [makeEdge("web", "api"), makeEdge("api", "shared-lib"), makeEdge("web", "shared-lib")]
);

function Harness({ source = "", target = "" }: { source?: string; target?: string }) {
  const [src, setSrc] = React.useState(source);
  const [tgt, setTgt] = React.useState(target);
  const [results, setResults] = React.useState<string[][] | null>(null);
  return (
    <PathFinderPanel
      graph={graph}
      pathSource={src}
      pathTarget={tgt}
      pathResults={results}
      onSourceChange={setSrc}
      onTargetChange={setTgt}
      onPathResults={setResults}
    />
  );
}

describe("PathFinderPanel", () => {
  it("keeps the search buttons disabled until two different repos are picked", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("button", { name: "Find shortest path" })).toBeDisabled();
    unmount();

    render(<Harness source="web" target="web" />);
    expect(screen.getByRole("button", { name: "Find all paths" })).toBeDisabled();
  });

  it("finds the shortest path and shows it", async () => {
    const { container } = render(<Harness source="web" target="shared-lib" />);

    fireEvent.click(screen.getByRole("button", { name: "Find shortest path" }));

    await waitFor(() => expect(screen.getByText("1 path found")).toBeInTheDocument());
    // The shortest route skips api: web depends on shared-lib directly.
    expect(container.querySelector(".dm-paths")).toHaveTextContent("webshared-lib");
  });

  it("finds every path, then clears the results", async () => {
    render(<Harness source="web" target="shared-lib" />);

    fireEvent.click(screen.getByRole("button", { name: "Find all paths" }));
    await waitFor(() => expect(screen.getByText("2 paths found")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("2 paths found")).toBeNull();
  });

  it("says so when there is no path", async () => {
    render(<Harness source="shared-lib" target="web" />);

    fireEvent.click(screen.getByRole("button", { name: "Find shortest path" }));

    await waitFor(() =>
      expect(screen.getByText("No path found from shared-lib to web.")).toBeInTheDocument()
    );
  });
});
