import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./responsive.css";
import "./refined-theme.css";
import "./site-experience.css";
import { SiteExperience } from "./site-experience";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Roteiva — Gestão para produção audiovisual",
  description: "Clientes, projetos, calendário, biblioteca, aprovações e financeiro em uma plataforma criada para profissionais do audiovisual.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body><SiteExperience/>{children}</body>
    </html>
  );
}
