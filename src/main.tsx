import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "./dashboard-client";
import { SiteExperience } from "./site-experience";
import { ReviewUnavailable } from "./review-unavailable";
import "./globals.css";
import "./responsive.css";
import "./refined-theme.css";
import "./site-experience.css";
import "./demo.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SiteExperience />
    {window.location.pathname.replace(/\/+$/, "").endsWith("/review") ? <ReviewUnavailable /> : <DashboardClient firstName="Visitante" email="demo@roteiva.local" />}
  </React.StrictMode>,
);
