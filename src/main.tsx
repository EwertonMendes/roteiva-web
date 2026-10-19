import React, { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "./dashboard-client";
import { SiteExperience } from "./site-experience";
import { ReviewUnavailable } from "./review-unavailable";
import { isDemo } from "./lib/firebase";
import { AuthProvider } from "./features/auth/AuthProvider";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { RegistrationGate } from "./features/auth/RegistrationGate";
import { AccessGate } from "./features/access/AccessGate";
import { FirebaseWorkspace } from "./features/workspace/FirebaseWorkspace";
import "./globals.css";
import "./responsive.css";
import "./refined-theme.css";
import "./site-experience.css";
import "./demo.css";
import "./features/auth/auth.css";
import "./features/settings/settings.css";
import "./features/typography/font-lab.css";
import "./typography.css";
import "./features/ui/semantic-icons.css";

class AppErrorBoundary extends Component<{children:ReactNode},{error:string}> {
  state={error:""};
  static getDerivedStateFromError(error:Error) { return {error:error.message}; }
  render() {
    return this.state.error ? <main className="auth-page"><section className="panel auth-card" role="alert"><h1>Não foi possível iniciar o Roteiva</h1><p>{this.state.error}</p><button className="primary-button" onClick={()=>window.location.reload()}>Tentar novamente</button></section></main> : this.props.children;
  }
}
const review=window.location.pathname.replace(/\/+$/, "").endsWith("/review");
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <SiteExperience />
  <AppErrorBoundary>{isDemo ? review ? <ReviewUnavailable /> : <DashboardClient firstName="Visitante" email="demo@roteiva.local" /> :
    <AuthProvider><ProtectedRoute><RegistrationGate><AccessGate>{review ? <ReviewUnavailable /> : <FirebaseWorkspace />}</AccessGate></RegistrationGate></ProtectedRoute></AuthProvider>}
  </AppErrorBoundary>
</React.StrictMode>);
