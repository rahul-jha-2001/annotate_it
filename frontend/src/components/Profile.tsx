import { UserProfile } from "@clerk/react";

export default function Profile() {
  return (
    <div className="container profile-page animate-fade-in">
      <div className="page-heading">
        <div>
          <h1>Your profile</h1>
          <p>Manage your identity, security, connected accounts, and active sessions.</p>
        </div>
      </div>
      <div className="clerk-profile-shell">
        <UserProfile routing="hash" />
      </div>
    </div>
  );
}
