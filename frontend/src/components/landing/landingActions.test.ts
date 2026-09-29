import { describe, expect, it } from "vitest";

import { landingActions, postAuthDestination } from "./landingActions";

describe("landing page actions", () => {
  it("routes visitors into authentication", () => {
    expect(landingActions(false)).toEqual({
      primary: { label: "Get started", href: "/signup" },
      account: { label: "Sign in", href: "/login" },
      catalog: { label: "Explore annotation types", href: "/catalog" },
    });
  });

  it("routes signed-in users into the product", () => {
    expect(landingActions(true)).toEqual({
      primary: { label: "Create experiment", href: "/experiments/new" },
      account: { label: "Open dashboard", href: "/dashboard" },
      catalog: { label: "Explore annotation types", href: "/catalog" },
    });
    expect(postAuthDestination).toBe("/dashboard");
  });
});
