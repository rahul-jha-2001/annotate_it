import { SignIn, SignUp } from "@clerk/react";
import { Activity } from "lucide-react";

export default function Login({ signup = false }: { signup?: boolean }) {
  return (
    <div className="auth-shell">
      <section className="glass-panel auth-card">
        <Activity size={38} className="app-logo-icon" />
        <h1>{signup ? "Create your account" : "Welcome back"}</h1>
        <p>{signup ? "Sign up to create and manage annotation experiments." : "Sign in to manage your experiments and profile."}</p>
        {signup ? (
          <SignUp routing="hash" signInUrl="/login" fallbackRedirectUrl="/" />
        ) : (
          <SignIn routing="hash" signUpUrl="/signup" fallbackRedirectUrl="/" />
        )}
      </section>
    </div>
  );
}
