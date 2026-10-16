# Desenvolvimento e deploy — React/Vite + Firebase Hosting

**Estado em 16/10/2026:** frontend estático **React 19 + Vite 8 + TypeScript**. Não existe backend, banco, autenticação real ou integração Drive ativa. [README](../README.md) · [Arquitetura](ARCHITECTURE.md) · [Roadmap](MVP-ROADMAP.md).

## Requisitos

- Node.js **22.13+** e PNPM **11.25.0**.
- Apenas `pnpm-lock.yaml` como lockfile. Instalar com `pnpm install --frozen-lockfile`.
- As fontes Ubuntu e licença estão em `public/fonts/ubuntu`; mantenha-as nos builds.

## Comandos

| Comando | Finalidade |
|---|---|
| `pnpm dev` | Servidor local Vite na raiz (normalmente http://localhost:5173) |
| `pnpm test` | Testes da agenda e do financeiro |
| `pnpm typecheck` | TypeScript sem emitir arquivos |
| `pnpm build` | Build **Firebase Hosting** com base `/` → `dist/` |
| `pnpm preview` | Preview do build Firebase |
| `pnpm build:pages` | Mesmo app com base `/roteiva-web/` → `dist-pages/` |
| `node scripts/verify-static-build.mjs dist /` | Conferir artefatos Firebase + fallback SPA |
| `node scripts/verify-static-build.mjs dist-pages /roteiva-web/` | Conferir artefatos Pages |

Não existem Next/Vinext, SSR, rotas de API, Workers, D1/R2 nem migrations. A única entrada é `index.html` e os componentes ficam em `src/`. Não adicionar serviços de servidor até iniciar a fase correspondente do MVP.

## Firebase Hosting — preparado, mas ainda não vinculado

O arquivo `firebase.json` está limitado a **Hosting**, com:

- `public: "dist"` — somente o resultado compilado é publicado.
- `rewrites: [{source: "**", destination: "/index.html"}]` — rotas da SPA funcionam quando abertas diretamente.
- Cache `immutable` para `/assets/**` (Vite gera nomes com hash); `index.html` sem cache forte.
- Sem Cloud Functions, Firestore Rules, Storage nem rotas privilegiadas.

Para o primeiro deploy, crie ou escolha um projeto no [Firebase Console](https://console.firebase.google.com/), ative **Hosting** (plano Spark enquanto couber nas franquias), faça login na CLI e execute:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
node scripts/verify-static-build.mjs dist /
pnpm dlx firebase-tools login
pnpm dlx firebase-tools deploy --only hosting --project SEU_PROJECT_ID
```

**Não executar `firebase init hosting` sem revisar o diff:** pode sobrescrever o `firebase.json` pré-configurado. `.firebaserc` não é exigido porque o comando informa `--project`; nunca versionar segredos ou ID de projeto fictício. O Hosting disponibiliza `https://SEU_PROJECT_ID.web.app/` quando provisionado.

## GitHub Actions

`deploy-pages.yml` roda em todo PR/push na `master`: instalação PNPM, testes, typecheck, build `dist/` e `dist-pages/`, verificações de arquivos. Somente push/dispatch publica o GitHub Pages.

`deploy-firebase.yml` é **manual**, por `workflow_dispatch`, com environment `firebase-production`. Ele requer no GitHub:

1. **Variable:** `FIREBASE_PROJECT_ID`, com o ID exato do projeto.
2. **Secret:** `FIREBASE_SERVICE_ACCOUNT`, JSON da conta de serviço autorizada para Firebase Hosting, configurado pela pessoa responsável pelo projeto.

O workflow **falha explicitamente** se variável/segredo não estiverem presentes, para evitar publicação em um projeto errado. Produção não é publicada automaticamente ao fazer merge. Para operação a longo prazo, preferir federação de identidade e permissões mínimas, se o mecanismo de deploy escolhido suportar.

## Estado da demonstração

- Navegação, clientes, projetos, tarefas, calendário, receitas/despesas, temas e exportação JSON funcionam **somente localmente**.
- Dados ficam em `localStorage["roteiva-pages-demo-workspace-v1"]`.
- **Dados não migram entre domínios:** Pages e Firebase têm origens distintas, então a mudança de URL começa com um armazenamento vazio.
- Uploads, login e aprovação remota continuam desativados. `/review` exibe uma página explicativa (SPA fallback no Firebase).
- Dados fictícios para testes; não inserir dados reais ou sigilosos.

## Checklist de QA

1. Acessar `/` e `/review` (inclusive atualização direta em `/review` no Hosting).
2. Conferir logo, favicon, fontes locais, CSS, intro, tema claro/escuro e responsividade.
3. Criar/editar/excluir clientes, projetos, tarefas, eventos, finanças; conferir CSV e JSON.
4. Recarregar e verificar persistência de dados no mesmo domínio/navegador.
5. Confirmar que não há chamadas `/api/**`, upload falso ou tela de erro de backend.
6. Testar mobile, teclado, movimento reduzido e modais.
7. Conferir tamanhos dos bundles e conteúdo do diretório publicado.

A verificação do CI **não substitui testes visuais**. Atualize o [roadmap](MVP-ROADMAP.md) e a arquitetura no mesmo PR, conforme [AGENTS.md](../AGENTS.md).
