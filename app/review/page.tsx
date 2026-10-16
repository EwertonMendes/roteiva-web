import Link from "next/link";

// O portal real de revisão dependerá de Firebase Auth e Google Drive.
// Não simular a API removida na demonstração.
export default function ReviewPage() {
  return (
    <main className="portal-page">
      <header><img src="/roteiva-logo-white.png" alt="Roteiva" /><span>ESPAÇO DE APROVAÇÃO</span></header>
      <section className="studio-section panel">
        <span className="eyebrow">MODO DEMONSTRAÇÃO</span>
        <h1>Aprovação de vídeos em breve</h1>
        <p>O acesso de clientes, as revisões e o envio de vídeos serão disponibilizados com a integração segura do Google Drive.</p>
        <Link className="primary-button" href="/">Voltar ao painel</Link>
      </section>
    </main>
  );
}
