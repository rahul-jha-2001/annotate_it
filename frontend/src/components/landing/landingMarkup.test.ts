import { describe, expect, it } from "vitest";

import { buildLandingMarkup } from "./landingMarkup";
import { landingActions } from "./landingActions";

describe("landing markup", () => {
  it("injects product CTAs without standalone scripts or global styles", () => {
    const markup = buildLandingMarkup(landingActions(false), "audio");
    expect(markup).toContain(`href="/signup">Get started</a>`);
    expect(markup).toContain(`href="/login">Sign in</a>`);
    expect(markup).toContain(`href="/catalog">Explore annotation types</a>`);
    expect(markup).toContain(`<a href="/catalog">Catalog</a>`);
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<style");
  });

  it("leads with the catalog and shows auditable export evidence", () => {
    const markup = buildLandingMarkup(landingActions(false), "audio");

    expect(markup).toContain(`<a class="button" href="/catalog">Explore annotation types</a>`);
    expect(markup).toContain("CONSENSUS DATASET");
    expect(markup).toContain("RAW ARCHIVE");
    expect(markup).toContain("SOURCE ANNOTATIONS");
    expect(markup).toContain("SOURCE CUTOFF");
    expect(markup).toContain("CONFIGURATION VERSION");
    expect(markup).toContain("CODE VERSION");
    expect(markup).toContain("ALGORITHM VERSION");
    expect(markup).toContain("SNAPSHOT CHECKSUM");
    expect(markup).toContain("87% gold accuracy · n=4 gold items");
    expect(markup).toContain("0.94 agreement · n=3 annotators");
  });

  it("renders the selected annotation specimen accessibly", () => {
    const markup = buildLandingMarkup(landingActions(true), "image");
    expect(markup).toContain(`id="tab-image" data-task="image" aria-selected="true" tabindex="0"`);
    expect(markup).toContain(`id="tab-audio" data-task="audio" aria-selected="false" tabindex="-1"`);
    expect(markup).toContain(`data-task="image" id="annotation-stage"`);
    expect(markup).toContain("Box the object");
  });
});
