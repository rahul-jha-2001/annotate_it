export interface LandingAction { label: string; href: string }
export interface LandingActions { primary: LandingAction; account: LandingAction; catalog: LandingAction }

export const postAuthDestination = "/dashboard";

export function landingActions(isSignedIn: boolean): LandingActions {
  return {
    primary: isSignedIn
      ? { label: "Create experiment", href: "/experiments/new" }
      : { label: "Get started", href: "/signup" },
    account: isSignedIn
      ? { label: "Open dashboard", href: "/dashboard" }
      : { label: "Sign in", href: "/login" },
    catalog: { label: "Explore annotation types", href: "/catalog" },
  };
}
