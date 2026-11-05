import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ControlBar } from "../../src/components/ControlBar";
import { makeEdge, makeGraph, makeNode } from "./fixtures";

type Props = React.ComponentProps<typeof ControlBar>;

function renderBar(overrides: Partial<Props> = {}) {
  const props: Props = {
    searchTerm: "",
    onSearchChange: jest.fn(),
    graph: null,
    reverseSearch: false,
    onReverseSearchToggle: jest.fn(),
    onTogglePathFinder: jest.fn(),
    showPathFinder: false,
    ...overrides,
  };
  render(<ControlBar {...props} />);
  return props;
}

const graph = makeGraph(
  [makeNode("checkout"), makeNode("shared-lib")],
  [makeEdge("checkout", "shared-lib")]
);

describe("ControlBar", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("debounces the search box before calling onSearchChange", () => {
    const props = renderBar();

    fireEvent.change(screen.getByLabelText("Search repositories"), { target: { value: "check" } });
    expect(props.onSearchChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("check");
  });

  it("relabels the search box in reverse (dependents) mode", () => {
    renderBar({ reverseSearch: true });
    expect(screen.getByLabelText("Search for dependents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dependents" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("slash focuses the search box and Escape clears it", () => {
    const props = renderBar({ searchTerm: "abc" });
    const input = screen.getByLabelText("Search repositories");

    fireEvent.keyDown(document, { key: "/" });
    expect(input).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onSearchChange).toHaveBeenCalledWith("");
    expect(input).not.toHaveFocus();
  });

  it("offers Find path and the exports only once a graph exists", () => {
    const { unmount } = render(
      <ControlBar
        searchTerm=""
        onSearchChange={jest.fn()}
        graph={null}
        reverseSearch={false}
        onReverseSearchToggle={jest.fn()}
        onTogglePathFinder={jest.fn()}
        showPathFinder={false}
      />
    );
    expect(screen.queryByRole("button", { name: "Find path" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Export" })).toBeNull();
    unmount();

    const props = renderBar({ graph });
    fireEvent.click(screen.getByRole("button", { name: "Find path" }));
    expect(props.onTogglePathFinder).toHaveBeenCalledTimes(1);
    for (const label of ["JSON", "SVG", "CSV nodes", "CSV edges"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("downloads the graph as JSON", () => {
    const createObjectURL = jest.fn(() => "blob:test");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderBar({ graph });
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
  });
});
