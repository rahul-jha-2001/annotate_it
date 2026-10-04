// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeAll } from "vitest";

import SpatialOverlay from "./SpatialOverlay";

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 500,
    height: 500,
    right: 500,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

describe("SpatialOverlay polygon vertices", () => {
  it("renders a handle for every completed polygon vertex", () => {
    const markup = renderToStaticMarkup(createElement(SpatialOverlay, {
      interaction: {
        kind: "spatial-shapes", tool: "polygon", newShapeLabel: "Car",
        frameAware: false, timeTolerance: 0, onChange: vi.fn(),
        shapes: [{ kind: "polygon", id: "polygon-1", label: "Car", points: [
          { x: 0.1, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.5, y: 0.8 },
        ] }],
      },
      mediaWidth: 100, mediaHeight: 100,
    }));
    expect(markup.match(/spatial-vertex-handle/g)).toHaveLength(3);
  });

  it("completes polygon marking when clicking the initial point handle", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SpatialOverlay
        interaction={{
          kind: "spatial-shapes",
          tool: "polygon",
          newShapeLabel: "Car",
          frameAware: false,
          timeTolerance: 0,
          onChange,
          shapes: [],
        }}
        mediaWidth={500}
        mediaHeight={500}
      />
    );

    const svg = container.querySelector("svg.spatial-overlay-canvas")!;

    // Place 3 points to form a triangle
    fireEvent.pointerDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.pointerDown(svg, { clientX: 250, clientY: 50 });
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 250 });

    // Initial vertex handle should now have can-close class and click handler
    const initialVertex = container.querySelector(".spatial-draft-vertex.can-close");
    expect(initialVertex).not.toBeNull();
    expect(initialVertex?.getAttribute("aria-label")).toContain("Click initial point to complete polygon");

    // Click on initial vertex handle
    fireEvent.pointerDown(initialVertex!);

    // onChange should be called with completed polygon
    expect(onChange).toHaveBeenCalledTimes(1);
    const completedShapes = onChange.mock.calls[0][0];
    expect(completedShapes).toHaveLength(1);
    expect(completedShapes[0]).toMatchObject({
      kind: "polygon",
      label: "Car",
    });
    expect(completedShapes[0].points).toHaveLength(3);
  });

  it("completes polygon marking when pressing Enter", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SpatialOverlay
        interaction={{
          kind: "spatial-shapes",
          tool: "polygon",
          newShapeLabel: "Car",
          frameAware: false,
          timeTolerance: 0,
          onChange,
          shapes: [],
        }}
        mediaWidth={500}
        mediaHeight={500}
      />
    );

    const overlay = container.querySelector(".spatial-overlay")!;
    const svg = container.querySelector("svg.spatial-overlay-canvas")!;

    // Place 3 points
    fireEvent.pointerDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.pointerDown(svg, { clientX: 250, clientY: 50 });
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 250 });

    // Press Enter on overlay
    fireEvent.keyDown(overlay, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      kind: "polygon",
      label: "Car",
    });
  });

  it("completes polygon marking when clicking near the initial point on the canvas", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SpatialOverlay
        interaction={{
          kind: "spatial-shapes",
          tool: "polygon",
          newShapeLabel: "Car",
          frameAware: false,
          timeTolerance: 0,
          onChange,
          shapes: [],
        }}
        mediaWidth={500}
        mediaHeight={500}
      />
    );

    const svg = container.querySelector("svg.spatial-overlay-canvas")!;

    // Place 3 points: initial point at (50, 50)
    fireEvent.pointerDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.pointerDown(svg, { clientX: 250, clientY: 50 });
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 250 });

    // Fourth click near initial point: (52, 51)
    fireEvent.pointerDown(svg, { clientX: 52, clientY: 51 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      kind: "polygon",
      label: "Car",
    });
    expect(onChange.mock.calls[0][0][0].points).toHaveLength(3);
  });
});
