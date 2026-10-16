# Desenvolvimento, testes e ambientes

> **Atualizado em 16/10/2026.** Este documento descreve primeiro o que é executável **hoje** e separa os ambientes de destino ainda planejados. Consulte [Arquitetura](ARCHITECTURE.md) e [Roadmap](MVP-ROADMAP.md).

## Requisitos e gerenciador de pacotes

- Node.js **22.13 ou superior**.
- Usar **PNPM 11.25.0** como no GitHub Actions; `pnpm-lock.yaml` é o lockfile utilizado no build da demonstração.
- O lockfile único é **`pnpm-lock.yaml`**. `package-lock.json` e os instaladores especiais do template foram removidos nesta higienização. O script `install:ci` é um alias para `pnpm install --frozen-lockfile`; não usar `npm ci`.

## Demonstração estática — disponível

```bash
pnpm install --frozen-lockfile
pnpm run test:calendar
pnpm run test:finance
pnpm run build:pages
pnpm exec vite preview --config vite.pages.config.ts --outDir dist-pages
```

A entrada de demonstração está em `pages/index.html` + `pages/main.tsx`; o build usa `vite.pages.config.ts` e publica `dist-pages/` com a base `/roteiva-web/`.

URL pública: **https://ewertonmendes.github.io/roteiva-web/**

O workflow `.github/workflows/deploy-pages.yml`:
- em PR para `master`: instala com PNPM fixo, executa testes de calendário/financeiro e compila a demo; **não publica PR**;
- em push para `master` ou disparo manual: faz o mesmo e publica o artifact em GitHub Pages;
- depende das configurações de GitHub Pages no repositório, não publica um backend.

**Limites da demo:** dados apenas no `localStorage` do navegador, sem contas reais, sem Firestore, sem Drive, sem upload, sem links públicos de revisão. O armazenamento local não é sincronizado e não deve conter dados de clientes reais. Para zerar a demonstração, limpe os dados do site no navegador. O backup JSON da interface inclui cadastros, não arquivos binários.

## Aplicação original Vinext/Cloudflare — legado de desenvolvimento

Entradas: `app/page.tsx`, `app/dashboard-client.tsx`, `app/studio-features.tsx` e rotas `app/api/**`.

Comandos disponíveis no `package.json` (sujeitos às dependências locais e bindings do ambiente):

```bash
pnpm run dev
pnpm run build
pnpm run start
pnpm run test:calendar
pnpm run test:finance
pnpm run lint
pnpm run db:generate
```

- `dev` executa o ambiente de desenvolvimento Vinext e o script `predev` prepara o banco local. Na configuração portátil, usualmente serve em `127.0.0.1:5173`.
- `build` gera o artefato legado, **não** a demonstração Pages.
- `start` faz preview local do Worker já compilado usando Wrangler e estado em `.wrangler/state`.
- `db:generate` gera migrations Drizzle destinadas ao D1 legado. Não reaproveitar essas migrations automaticamente no Firestore.
- Componentes gerados e não utilizados do template (`components/ui`, exemplos D1 e assets de amostra) foram retirados. Os scripts necessários ao preview Vinext/Worker **ainda estão presentes**: não apagá-los sem migração e testes.
- `tests/studio-api.test.mjs` valida endpoints antigos contra servidor local isolado; **não está** na pipeline de GitHub Pages. Exige ambiente apropriado.
- Os arquivos binários do legado e sua base local ficam sob estado Wrangler, não são compartilhados com o GitHub Pages.
- O login local simulado de ChatGPT pode funcionar no ambiente portátil legado. **Não** é login de produção e será substituído por Firebase Authentication.

Os guias antigos de teste que tratavam armazenamento só no navegador e, alternativamente, mídia real em R2 descreviam versões distintas. Este documento centraliza essas distinções.

## Fluxos manuais de validação da interface

1. Navegar entre Início, Clientes, Projetos, Agenda, Financeiro, Biblioteca e Aprovações no desktop e celular.
2. Conferir temas claro/escuro e a experiência com movimento reduzido.
3. Cadastrar clientes recorrentes/avulsos, projetos, tarefas e prazos; testar filtros, edição e exclusão.
4. Validar agenda com horários de início/término e aviso de sobreposição.
5. Validar receitas, despesas, parcelas, cálculos em centavos, filtro mensal e exportação.
6. Recarregar a demo e conferir persistência **somente local**.
7. Verificar que recursos de upload, autenticação, sincronização e revisões remotas **não são anunciados como funcionais na demo**.

## Ambientes-alvo do MVP — ainda não provisionados

| Ambiente | Proposta | Observações |
|---|---|---|
| DEV | Firebase Hosting + Auth + Firestore isolados; Worker/D1 DEV; OAuth Google DEV | Dados artificiais; origens e redirect URIs próprias |
| PROD | Firebase Hosting + Auth + Firestore produção; Worker/D1 produção; OAuth Google produção | Separar credenciais, regras e segredos de DEV |
| DEMO | GitHub Pages atual | Preservar como visualização isolada, sem dados reais |

**Planejado, não ativo:** workflows separados para testes das regras do Firestore, testes de OAuth, build do frontend final, deploy DEV e deploy PROD controlado. Não documentar comandos de deploy Firebase/Workers como existentes antes de criar os projetos, configurações e pipelines.

## Configuração e segredos — planejado

- Configuração pública do Firebase Web (API key, auth domain, project ID etc.) no frontend; a API key web **não é um segredo** nem substitui Security Rules.
- Worker Secrets: client secret OAuth, chave de criptografia com versão e outros segredos de servidor.
- D1 binding associado ao Worker para tokens cifrados, revisões de integração e auditoria mínima.
- URLs autorizadas CORS, OAuth redirect URIs e domínios permitidos por ambiente.
- Nunca copiar valores reais para README, PR, exemplos de `.env` ou logs.
- Aplicar migrations do D1 de DEV/PROD via processo controlado; testar restauração e rollback antes do lançamento.

## Acompanhamento e custos

Monitorar Workers (requisições/CPU/erros), D1 (linhas/armazenamento), Firestore (leituras/gravações), Hosting (transferência), Drive (erros/quota) e sucesso/falha de OAuth. A meta de **R$ 0** vale apenas dentro das franquias gratuitas e não constitui garantia de custo fixo.

## Ao alterar implementação

Atualizar obrigatoriamente `docs/MVP-ROADMAP.md`; atualizar arquitetura, README, desenvolvimento e design conforme impacto. Consulte [AGENTS.md](../AGENTS.md) e o checklist de PR.
