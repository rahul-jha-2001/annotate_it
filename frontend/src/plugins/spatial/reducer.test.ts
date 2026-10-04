import { describe, expect, it } from "vitest";

import { initialSpatialState, spatialReducer } from "./reducer";
import type { SpatialShape } from "./types";

const box: SpatialShape = {
  kind: "bounding_box",
  id: "box-1",
  label: "Car",
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
};

describe("spatial reducer", () => {
  it("creates, selects, updates, and deletes without mutating prior states", () => {
    const start = initialSpatialState([box]);
    const selected = spatialReducer(start, { type: "select", id: "box-1" });
    const updated = spatialReducer(selected, {
      type: "update",
      id: "box-1",
      patch: { x: 0.25 },
    });
    const created = spatialReducer(updated, {
      type: "create",
      shape: { ...box, id: "box-2", label: "Person" },
    });
    const deleted = spatialReducer(created, { type: "delete", id: "box-1" });

    expect(start.shapes[0]).toBe(box);
    expect(updated.shapes[0]).toMatchObject({ id: "box-1", x: 0.25 });
    expect(created.shapes.map(shape => shape.id)).toEqual(["box-1", "box-2"]);
    expect(deleted.shapes.map(shape => shape.id)).toEqual(["box-2"]);
    expect(created.shapes).toHaveLength(2);
    expect(deleted.selectedId).toBe("box-2");
  });

  it("keeps IDs stable and rejects duplicate creation IDs", () => {
    const state = initialSpatialState([box]);
    expect(spatialReducer(state, { type: "update", id: "box-1", patch: { label: "Truck" } }).shapes[0].id).toBe("box-1");
    expect(() => spatialReducer(state, { type: "create", shape: { ...box } })).toThrow(/unique/i);
  });

  it("requires three unique polygon points and undoes only the latest point", () => {
    let state = spatialReducer(initialSpatialState(), {
      type: "start-draft",
      kind: "polygon",
      label: "Car",
      id: "polygon-1",
    });
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.1, y: 0.1 } });
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.8, y: 0.1 } });
    expect(() => spatialReducer(state, { type: "complete-draft" })).toThrow(/three unique/i);
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.5, y: 0.8 } });
    const beforeUndo = state;
    state = spatialReducer(state, { type: "undo-draft-point" });
    expect(state.draft?.points).toHaveLength(2);
    expect(beforeUndo.draft?.points).toHaveLength(3);
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.5, y: 0.8 } });
    const completed = spatialReducer(state, { type: "complete-draft" });
    expect(completed.shapes[0]).toMatchObject({ kind: "polygon", id: "polygon-1", label: "Car" });
    expect(completed.draft).toBeNull();
  });

  it("strips trailing closing point when completing polygon draft", () => {
    let state = spatialReducer(initialSpatialState(), {
      type: "start-draft",
      kind: "polygon",
      label: "Car",
      id: "polygon-1",
    });
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.1, y: 0.1 } });
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.8, y: 0.1 } });
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.5, y: 0.8 } });
    // Simulate user or tool adding the start point again at the end:
    state = spatialReducer(state, { type: "add-draft-point", point: { x: 0.1, y: 0.1 } });
    expect(state.draft?.points).toHaveLength(4);
    const completed = spatialReducer(state, { type: "complete-draft" });
    const poly = completed.shapes[0];
    expect(poly.kind).toBe("polygon");
    if (poly.kind === "polygon") {
      expect(poly.points).toHaveLength(3);
      expect(poly.points).toEqual([
        { x: 0.1, y: 0.1 },
        { x: 0.8, y: 0.1 },
        { x: 0.5, y: 0.8 },
      ]);
    }
  });

  it("does not emit changes in readonly mode", () => {
    const state = { ...initialSpatialState([box]), readonly: true };
    expect(spatialReducer(state, { type: "delete", id: "box-1" })).toBe(state);
    expect(spatialReducer(state, { type: "select", id: "box-1" })).toBe(state);
  });
});
