import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SpatialOverlay from "./SpatialOverlay";

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
});
