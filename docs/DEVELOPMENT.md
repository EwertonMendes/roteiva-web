# Desenvolvimento, testes e ambientes

> Atualizado em 16/10/2026. Este repositório **preserva Next.js/Vinext e seu frontend original**. As APIs de negócio e os bancos legados foram removidos por decisão explícita. [Arquitetura](ARCHITECTURE.md) · [Roadmap](MVP-ROADMAP.md).

## Instalação

Node.js **22.13+**, PNPM **11.25.0** e `pnpm-lock.yaml` (lockfile único).

```bash
pnpm install --frozen-lockfile
```

## Dois modos do mesmo frontend

**Next.js 16 + Vinext + React (original, preservado):**

```bash
pnpm dev
pnpm run build
pnpm start
```

- `app/page.tsx` mostra `app/dashboard-client.tsx` com `demoMode`, sem login antigo.
- `app/layout.tsx`, `app/site-experience.tsx`, estilos e componentes foram mantidos.
- `vite.config.ts`, `next.config.ts`, `build/sites-worker.ts` e os scripts de runtime permanecem para **renderização do frontend Next/Vinext**.
- O adaptador Vinext utiliza runtime Cloudflare, mas **sem D1, R2, conectores ou rotas de API de negócio**. Isso é infraestrutura de renderização do Next, não backend próprio do SaaS.
- `app/review/page.tsx` informa que o portal real ainda não está disponível.

**Demonstração estática para GitHub Pages (preservada):**

```bash
pnpm run test:calendar
pnpm run test:finance
pnpm run build:pages
pnpm exec vite preview --config vite.pages.config.ts --outDir dist-pages
```

- Entrada `pages/index.html` + `pages/main.tsx`; build `dist-pages/` com base `/roteiva-web/`.
- A demo pública está em **https://ewertonmendes.github.io/roteiva-web/**.
- Ambas as entradas usam os **mesmos componentes React**; a versão Pages não tem backend e mantém a chave de dados `roteiva-pages-demo-workspace-v1`.
- A persistência é local ao navegador; sem login, sincronização entre dispositivos, upload, API, R2 ou revisão por links. Não inserir dados sensíveis ou reais.

## Comandos existentes

| Script | Finalidade |
|---|---|
| `dev` | Desenvolver frontend Next/Vinext |
| `build` | Compilar frontend Next/Vinext |
| `start` | Visualizar build local do frontend Vinext |
| `build:pages` | Compilar demonstração estática para Pages |
| `test:calendar` | Testar lógica da agenda |
| `test:finance` | Testar cálculos financeiros e sincronização local |
| `lint` | ESLint do frontend |

Não existem mais `predev`, `db:generate`, `db:local` ou migrations. Não há necessidade de preparar banco ao iniciar `pnpm dev`.

## Validação e publicação

O workflow `.github/workflows/deploy-pages.yml` instala com PNPM congelado, executa testes de calendário/financeiro e compila a demo Pages. A partir desta limpeza, também deve **compilar Next/Vinext no CI** para evitar regressões nessa camada. Em PR apenas valida; o push na `master` publica o Pages.

Revisar manualmente desktop/mobile, ambos os temas, cadastros, agenda, financeiro, importação/exportação JSON e navegação. Conferir que telas de arquivos e revisão não tentem utilizar APIs removidas. Uma build verde não substitui teste visual.

## Serviços futuros (não implementados)

Firebase Hosting/Auth/Firestore, Cloudflare Workers/D1 para credenciais OAuth e o Google Drive individual são **plano do MVP**, e serão criados do zero. Ver [arquitetura](ARCHITECTURE.md) e [roadmap](MVP-ROADMAP.md).

Toda IA deve atualizar a documentação **no mesmo PR** em que alterar código, conforme [AGENTS.md](../AGENTS.md).
