import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
export function LoginPage() {
  const {login, busy, error} = useAuth();
  useEffect(() => {
    document.documentElement.setAttribute("data-roteiva-ready", "true");
    window.dispatchEvent(new Event("roteiva:ready"));
  }, []);
  return <main className="auth-page"><section className="panel auth-card">
    <img className="auth-brand" src={import.meta.env.BASE_URL + "roteiva-logo-black.png"} alt="Roteiva" />
    <span className="eyebrow">SEU ESPAÇO DE PRODUÇÃO · DEV</span>
    <h1>Organize o próximo capítulo.</h1>
    <p>Clientes, projetos, agenda e financeiro no ritmo da sua produção.</p>
    <button className="primary-button auth-google" disabled={busy} onClick={() => void login()}>{busy ? "Conectando…" : "Entrar com Google"}</button>
    {error && <p role="alert" className="auth-error">{error}</p>}
    <small>Seu espaço começa vazio e seus dados ficam vinculados à sua conta. A conexão com Google Drive será disponibilizada em outra etapa.</small>
  </section></main>;
}
