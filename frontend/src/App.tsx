import { Route, Switch, Link } from "wouter";
import { Activity, LayoutDashboard, Plus } from "lucide-react";
import Dashboard from "./components/Dashboard";
import CreateExperiment from "./components/CreateExperiment";
import Annotator from "./components/Annotator";
import ExperimentDashboard from "./components/ExperimentDashboard";
import ReviewAnnotations from "./components/ReviewAnnotations";

function App() {
  return (
    <>
      <header className="app-header">
        <Link href="/" className="app-logo">
          <Activity className="app-logo-icon" size={28} />
          Annotate It
        </Link>
        <nav className="app-nav" aria-label="Main navigation">
          <Link href="/" className="nav-link">
            <LayoutDashboard size={17} /> Dashboard
          </Link>
          <Link href="/experiments/new" className="nav-link nav-link-primary">
            <Plus size={17} /> New Experiment
          </Link>
        </nav>
      </header>

      <main>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/experiments/new">
            <div className="container animate-fade-in">
              <div className="flex-col" style={{ alignItems: "center", textAlign: "center", marginBottom: "40px" }}>
                <h1>Annotation Experiment Platform</h1>
                <p style={{ maxWidth: "600px", fontSize: "1.1rem" }}>
                  Design tasks, get them annotated, and track quality live via gold-standard items.
                </p>
              </div>
              <CreateExperiment />
            </div>
          </Route>
          <Route path="/experiments/:id/review">
            {(params) => <ReviewAnnotations experimentId={params.id!} />}
          </Route>
          <Route path="/experiments/:id">
            {(params) => <ExperimentDashboard experimentId={params.id!} />}
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
