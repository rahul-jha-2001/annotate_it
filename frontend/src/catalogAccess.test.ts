import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";

describe("catalog route access", () => {
  it("keeps the catalog list and detail routes outside the authentication boundary", () => {
    expect(appSource).toContain(
      '<Route path="/catalog"><AnnotationCatalog /></Route>',
    );
    expect(appSource).toContain(
      '(params) => <AnnotationCatalogDetail presetSlug={params.presetSlug!} />',
    );
  });
});
