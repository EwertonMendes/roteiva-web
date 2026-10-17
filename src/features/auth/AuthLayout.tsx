import { useEffect, type ReactNode } from "react";
import { ArrowUpRight, Film, ShieldCheck } from "lucide-react";

type AuthLayoutProps = {
  children: ReactNode;
  section: string;
  title: string;
  description: string;
};

export function AuthLayout({children,section,title,description}: AuthLayoutProps) {
  useEffect(()=>{
    document.documentElement.setAttribute("data-roteiva-ready","true");
    window.dispatchEvent(new Event("roteiva:ready"));
  },[]);
  return <main className="auth-page auth-layout">
    <aside className="auth-story" aria-label="Apresentação do Roteiva">
      <div className="auth-story-top">
        <img src={import.meta.env.BASE_URL+"roteiva-logo-white.png"} alt="Roteiva" className="auth-story-logo"/>
        <span className="auth-story-edition">STUDIO / DEV</span>
      </div>
      <div className="auth-story-art" aria-hidden="true">
        <span className="auth-art-ring auth-art-ring-one"/>
        <span className="auth-art-ring auth-art-ring-two"/>
        <span className="auth-art-ring auth-art-ring-three"/>
        <span className="auth-art-axis"/>
        <span className="auth-art-dot"/>
        <span className="auth-art-frame">R / 001</span>
      </div>
      <div className="auth-story-copy">
        <span className="auth-story-kicker"><Film size={15} strokeWidth={1.6}/> PARA QUEM VIVE DE CRIAR</span>
        <p>Mais espaço para o que realmente importa.</p>
        <span>Da primeira ideia à entrega final. Seu trabalho, em ordem.</span>
      </div>
      <div className="auth-story-foot">
        <span>PROJETOS / CLIENTES / FINANCEIRO</span>
        <ArrowUpRight size={17} strokeWidth={1.5} aria-hidden="true"/>
      </div>
    </aside>
    <section className="auth-content">
      <div className="auth-content-inner">
        <div className="auth-content-head">
          <span className="auth-step">{section}</span>
          <span className="auth-safe"><ShieldCheck size={14} strokeWidth={1.8}/> ACESSO SEGURO</span>
        </div>
        <header className="auth-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        <div className="auth-bottom"><span>ROTEIVA</span><span>AMBIENTE DE DESENVOLVIMENTO</span></div>
      </div>
    </section>
  </main>;
}
