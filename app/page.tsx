import DashboardClient from "./dashboard-client";

// A aplicação Next/Vinext continua disponível como frontend de demonstração.
// Autenticação Firebase e persistência remota serão implementadas no MVP.
export default function Home() {
  return <DashboardClient firstName="Visitante" email="demo@roteiva.local" demoMode />;
}
