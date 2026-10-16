/** Placeholder for the route that will be backed by private Firebase/Drive permissions. */
export function ReviewUnavailable() {
  return (
    <main className="portal-page">
      <header><img src={`${import.meta.env.BASE_URL}roteiva-logo-white.png`} alt="Roteiva" /><span>ESPAÇO DE APROVAÇÃO</span></header>
      <section className="studio-section panel">
        <span className="eyebrow">MODO DEMONSTRAÇÃO</span>
        <h1>Aprovação de vídeos em breve</h1>
        <p>O acesso de clientes, as revisões e o envio de vídeos serão disponibilizados com a integração segura do Google Drive.</p>
        <a className="primary-button" href={import.meta.env.BASE_URL}>Voltar ao painel</a>
      </section>
    </main>
  );
}
