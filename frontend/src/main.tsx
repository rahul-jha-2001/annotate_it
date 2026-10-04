import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import App from './App.tsx'
import './index.css'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {publishableKey ? (
      <ClerkProvider
        publishableKey={publishableKey}
        signInFallbackRedirectUrl="/dashboard"
        signUpFallbackRedirectUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: '#087796',
            colorForeground: '#102A32',
            colorBackground: '#ffffff',
            colorInput: '#ffffff',
            colorInputForeground: '#102A32',
            borderRadius: '0.625rem',
          },
        }}
      >
        <App />
      </ClerkProvider>
    ) : (
      <main className="auth-shell">
        <section className="glass-panel auth-card">
          <h1>Clerk is not configured</h1>
          <p>Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to the frontend environment and restart Vite.</p>
        </section>
      </main>
    )}
  </React.StrictMode>,
)
