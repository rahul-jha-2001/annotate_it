import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LandingPage from "./LandingPage";

describe("LandingPage", () => {
  it("renders the supplied TaskGlass product sheet with signed-out actions", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage, { isSignedIn: false }));
    expect(markup).toContain(`class="landing-page"`);
    expect(markup).toContain("Run your annotation experiment");
    expect(markup).toContain(`href="/signup">Get started</a>`);
  });
});
