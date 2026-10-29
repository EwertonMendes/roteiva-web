import React, { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "./dashboard-client";
import { SiteExperience } from "./site-experience";
import { ReviewUnavailable } from "./review-unavailable";
import { ReviewPortal } from "./features/reviews/ReviewPortal";
import { isDemo } from "./lib/firebase";
import { AuthProvider } from "./features/auth/AuthProvider";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { RegistrationGate } from "./features/auth/RegistrationGate";
import { AccessGate } from "./features/access/AccessGate";
import {DriveTransfersProvider} from "./features/drive/DriveTransfersProvider";
import { FirebaseWorkspace } from "./features/workspace/FirebaseWorkspace";
import "./globals.css";
import "./responsive.css";
import "./refined-theme.css";
import "./site-experience.css";
import "./demo.css";
import "./features/auth/auth.css";
import "./features/settings/settings.css";
import "./typography.css";
import "./features/ui/workspace-page-heading.css";
import "./features/ui/semantic-icons.css";
import "./features/dashboard/dashboard.css";
import "./features/ui/AppSelect.css";

class AppErrorBoundary extends Component<{children:ReactNode},{error:string}> {
  state={error:""};
  static getDerivedStateFromError(error:Error) { return {error:error.message}; }
  render() {
    return this.state.error ? <main className="auth-page"><section className="panel auth-card" role="alert"><h1>Não foi possível iniciar o Roteiva</h1><p>{this.state.error}</p><button className="primary-button" onClick={()=>window.location.reload()}>Tentar novamente</button></section></main> : this.props.children;
  }
}
const review=window.location.pathname.replace(/\/+$/, "").endsWith("/review");
const publicToken=/^\/review\/([A-Za-z0-9_-]{43})\/?$/.exec(window.location.pathname)?.[1];
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <SiteExperience />
  <AppErrorBoundary>{isDemo ? review ? <ReviewUnavailable /> : <DashboardClient firstName="Visitante" email="demo@roteiva.local" /> :
    <AuthProvider>{publicToken ? <ReviewPortal token={publicToken}/> : <ProtectedRoute><RegistrationGate><AccessGate>{review ? <ReviewUnavailable /> : <DriveTransfersProvider><FirebaseWorkspace /></DriveTransfersProvider>}</AccessGate></RegistrationGate></ProtectedRoute>}</AuthProvider>}
  </AppErrorBoundary>
</React.StrictMode>);
