import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import LandingPage from "./LandingPage";

describe("LandingPage", () => {
  it("renders the supplied TaskGlass product sheet with signed-out actions", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage, { isSignedIn: false }));
    expect(markup).toContain(`class="landing-page"`);
    expect(markup).toContain("Run your annotation experiment");
    expect(markup).toContain(`href="/signup">Get started</a>`);
  });

  it("defines AA-safe foreground tokens for muted and gold landing-page text", () => {
    const stylesheet = readFileSync(fileURLToPath(new URL("./landing.css", import.meta.url)), "utf8");

    expect(stylesheet).toContain("--muted-strong:#4f6368");
    expect(stylesheet).toContain("--gold-ink:#8a570d");
  });

  it("keeps functional landing-page type at an 11px minimum", () => {
    const stylesheet = readFileSync(fileURLToPath(new URL("./landing.css", import.meta.url)), "utf8");

    expect(stylesheet).not.toMatch(/font-size:(?:9|10)px/);
  });

  it("keeps app feedback visible while reducing motion on request", () => {
    const stylesheet = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");

    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesheet).toContain(".animate-fade-in { animation: fadeInReduced");
    expect(stylesheet).toContain(".warning-toast { animation: toastInReduced");
  });

  it("keeps the compact navigation action touch-sized", () => {
    const stylesheet = readFileSync(fileURLToPath(new URL("./landing.css", import.meta.url)), "utf8");

    expect(stylesheet).toContain(".landing-page .nav .nav-action{min-width:44px;min-height:44px");
    expect(stylesheet).toContain(".landing-page .nav .nav-action:active{background:var(--ink);color:white}");
  });
});
