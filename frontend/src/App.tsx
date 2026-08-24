import { Route, Switch, Link } from "wouter";
import { Activity } from "lucide-react";
import Dashboard from "./components/Dashboard";
import CreateExperiment from "./components/CreateExperiment";
import Annotator from "./components/Annotator";

function App() {
  return (
    <>
      <header className="app-header">
        <Link href="/" className="app-logo">
          <Activity className="app-logo-icon" size={28} />
          Annotate It
        </Link>
        <nav>
          {/* Add navigation items if needed */}
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
          <Route path="/experiments/:id">
            {(params) => <div className="container">Experiment {params.id} Details Page - Coming soon</div>}
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
