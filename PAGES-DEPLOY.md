# GitHub Pages — Roteiva (demonstração)

URL: https://ewertonmendes.github.io/roteiva-web/

## O que é publicado

O workflow `.github/workflows/deploy-pages.yml` roda automaticamente ao enviar código à `master` e pode ser acionado manualmente. Pull requests validam os testes de calendário/financeiro e compilam a demonstração sem fazer deploy.

- Node.js 22, `npm ci`, testes, `npm run build:pages`;
- Vite produz HTML/CSS/JS estáticos em `dist-pages`, servidos pelo GitHub Pages;
- a interface reaproveita o DashboardClient e estilos do projeto original;
- projetos, clientes, agenda e financeiro funcionam no navegador e os dados são salvos **apenas no localStorage daquele navegador**, sob chave separada da aplicação original;
- o aviso de demonstração aparece na tela.

## Limites importantes

O GitHub Pages **não executa** o servidor Next.js/Vinext, `app/api/**`, autenticação ChatGPT, banco Cloudflare D1 ou armazenamento Cloudflare R2.

Portanto a publicação é um ambiente de **demonstração local**, sem contas reais, sincronização entre dispositivos, envio de mídias ou aprovação pública por link. Essas operações não devem ser consideradas habilitadas. Não use dados sensíveis, arquivos privados ou cadastros reais para testes no Pages.

A versão original permanece intacta para uma implantação full-stack futura. Para habilitar todas as funções será preciso implantar um servidor compatível com as rotas de API, configurar autenticação segura e provisionar o banco/armazenamento.

## Build local

```bash
npm ci
npm run build:pages
```

O HTML gerado espera ser hospedado em `/roteiva-web/`, que é a base do projeto no GitHub Pages. Para verificar localmente, use `npx vite preview --config vite.pages.config.ts --outDir dist-pages`.

## Sobre dados

Para reiniciar a demonstração, limpe os dados deste site no navegador. Os registros não são compartilhados nem sincronizados em um servidor.
