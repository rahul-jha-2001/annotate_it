import type { ReactNode } from "react";
import { RedirectToSignIn, useAuth, useClerk, useUser } from "@clerk/react";
import { Route, Switch, Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, LogIn, LogOut, Plus, UserRound } from "lucide-react";
import Dashboard from "./components/Dashboard";
import CreateExperiment from "./components/CreateExperiment";
import Annotator from "./components/Annotator";
import ExperimentDashboard from "./components/ExperimentDashboard";
import ReviewAnnotations from "./components/ReviewAnnotations";
import Login from "./components/Login";
import Profile from "./components/Profile";
import ExperimentAnnotators, { AnnotatorDetail } from "./components/ExperimentAnnotators";
import ExperimentSettings from "./components/ExperimentSettings";
import { setAuthTokenGetter } from "./api";

function Protected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="container text-center">Loading account…</div>;
  if (!isSignedIn) return <RedirectToSignIn />;
  return <>{children}</>;
}

function App() {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();
  setAuthTokenGetter(() => getToken());
  const displayName = user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "Account";
  return (
    <>
      <header className="app-header">
        <Link href="/" className="app-logo">
          <Activity className="app-logo-icon" size={28} />
          Annotate It
        </Link>
        <nav className="app-nav" aria-label="Main navigation">
          {isSignedIn ? <>
            <Link href="/" className="nav-link"><LayoutDashboard size={17} /> Dashboard</Link>
            <Link href="/experiments/new" className="nav-link nav-link-primary"><Plus size={17} /> New Experiment</Link>
            <Link href="/profile" className="nav-link"><UserRound size={17} /> {displayName}</Link>
            <button className="nav-link nav-button" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut size={17} /> Sign out</button>
          </> : <Link href="/login" className="nav-link nav-link-primary"><LogIn size={17} /> Sign in</Link>}
        </nav>
      </header>

      <main>
        <Switch>
          <Route path="/login"><Login /></Route>
          <Route path="/signup"><Login signup /></Route>
          <Route path="/profile"><Protected><Profile /></Protected></Route>
          <Route path="/"><Protected><Dashboard /></Protected></Route>
          <Route path="/experiments/new">
            <Protected><div className="container animate-fade-in">
              <div className="flex-col" style={{ alignItems: "center", textAlign: "center", marginBottom: "40px" }}>
                <h1>Annotation Experiment Platform</h1>
                <p style={{ maxWidth: "600px", fontSize: "1.1rem" }}>
                  Design tasks, get them annotated, and track quality live via gold-standard items.
                </p>
              </div>
              <CreateExperiment />
            </div></Protected>
          </Route>
          <Route path="/experiments/:id/review">
            {(params) => <Protected><ReviewAnnotations experimentId={params.id!} /></Protected>}
          </Route>
          <Route path="/experiments/:id/annotators/:annotatorId">
            {(params) => <Protected><AnnotatorDetail experimentId={params.id!} annotatorId={params.annotatorId!} /></Protected>}
          </Route>
          <Route path="/experiments/:id/annotators">
            {(params) => <Protected><ExperimentAnnotators experimentId={params.id!} /></Protected>}
          </Route>
          <Route path="/experiments/:id/settings">
            {(params) => <Protected><ExperimentSettings experimentId={params.id!} /></Protected>}
          </Route>
          <Route path="/experiments/:id">
            {(params) => <Protected><ExperimentDashboard experimentId={params.id!} /></Protected>}
          </Route>
          <Route path="/annotate/:shareToken">
            {(params) => <Annotator shareToken={params.shareToken!} />}
          </Route>
          <Route>
            <div className="container text-center">
              <h2>404 - Not Found</h2>
            </div>
          </Route>
        </Switch>
      </main>
    </>
  );
}

export default App;
