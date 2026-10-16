import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "../app/dashboard-client";
import { SiteExperience } from "../app/site-experience";
import "../app/globals.css";
import "../app/responsive.css";
import "../app/refined-theme.css";
import "../app/site-experience.css";
import "./demo.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SiteExperience />
    <DashboardClient firstName="Visitante" email="demo@roteiva.local" demoMode />
  </React.StrictMode>,
);
