# Desenvolvimento e deploy — Roteiva

[README](../README.md) · [Arquitetura](ARCHITECTURE.md) · [Roadmap](MVP-ROADMAP.md).

React 19/Vite 8/TypeScript, sem SSR, Next/Vinext, Functions, Worker ou D1 ativo. Node 22.13+, PNPM 11.25.0 e Java 21 para emuladores. Somente `pnpm-lock.yaml`; instalação congelada obrigatória.

## Comandos

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Dependências travadas |
| `pnpm dev` | Demo Vite sem login |
| `pnpm dev --mode firebase` | DEV Firebase (config pública em .env.firebase / overrides .env.local) |
| `pnpm test` | Agenda, dinheiro e mensagens de falha do login |
| `pnpm typecheck` | TypeScript sem emissão |
| `pnpm build` | Firebase explícito → dist/ |
| `pnpm build:pages` | Demo explícita → dist-pages/ sob /roteiva-web/ |
| `pnpm build:emulator` | Firebase fictício → dist-emulator/ |
| `pnpm exec playwright install chromium` | Navegador de teste |
| `pnpm test:firebase` | Auth/Firestore Emulator + regras, repositório e navegador |
| `node scripts/verify-static-build.mjs dist /` | SPA e assets Firebase |
| `node scripts/verify-static-build.mjs dist-pages /roteiva-web/` | Artefatos Pages |

As dependências desta PR foram instaladas e o lockfile gerado em GitHub Actions. Nenhuma CLI ou clone foi instalado no computador do proprietário. O job temporário que preparou o lockfile foi retirado; não é parte do CI final.

## Variáveis públicas Vite

`.env.example` é um modelo vazio. `.env.firebase` contém somente a configuração **pública** do app DEV registrado; `.env.demo` desativa Firebase; `.env.emulator` usa dados fictícios e `demo-roteiva`. `.env.local` é ignorado pelo Git.

| Variável | Necessidade |
|---|---|
| VITE_APP_MODE | `demo` ou `firebase`, obrigatório |
| VITE_FIREBASE_API_KEY | Chave pública do SDK, obrigatória no Firebase |
| VITE_FIREBASE_AUTH_DOMAIN | Domínio Firebase Auth, obrigatório |
| VITE_FIREBASE_PROJECT_ID | Somente `roteiva-web-dev`; testes exigem `demo-roteiva` |
| VITE_FIREBASE_APP_ID | App Web registrado, obrigatório |
| VITE_FIREBASE_MESSAGING_SENDER_ID | Número do projeto, obrigatório |
| VITE_FIREBASE_STORAGE_BUCKET | Opcional; nenhum bucket é utilizado/provisionado |
| VITE_USE_EMULATORS | Apenas testes explícitos; endpoints 127.0.0.1:9099/8080 |

Nunca colocar service account JSON, private keys, refresh tokens ou segredos administrativos em `VITE_*`. O app mostra erro de configuração quando variáveis obrigatórias faltam. A demo não inicializa SDK/consulta/grava Firebase.

## Autenticação e dados

Google é o único provedor habilitado. Sessão em persistência local gerenciada pelo Firebase Auth; estado observado por `onAuthStateChanged`; telas privadas somente após a verificação. Popup acionado diretamente pelo clique, após inicializar persistência. Bloqueio, cancelamento, rede e expiração têm mensagens próprias.

Domínios autorizados: `roteiva-web-dev.web.app`, `roteiva-web-dev.firebaseapp.com`, `localhost` (desenvolvimento). O Pages não é domínio de login. Não há escopos Drive. Redirecionamento OAuth automático não foi adicionado: exige validação específica de armazenamento entre origens e mobile. Safari/iOS e navegadores embutidos devem ter QA real antes de divulgação ampla.

Dados privados somente em memória da aplicação e Firestore; nenhuma migração da demo ou cache Firestore persistente em disco. Carregamento paginado em blocos de 200, uma vez por abertura/recarregamento explícito; sem listeners globais. Atualizações concorrentes de um mesmo documento são rejeitadas pela revisão, com recuperação explícita. Atualizações independentes não regravam coleções inteiras. Uma transação limita alterações simultâneas a 400 documentos; pacotes de entregas permitem até 100 itens.

Exportação JSON/CSV preservada. O JSON reflete os dados carregados e não inclui mídia. Ao perder rede/permissão ou ocorrer conflito, o painel oferece recarregar a nuvem, descartando alterações não confirmadas. Uma navegação enquanto grava dispara aviso de saída.

## Regras e testes

`firestore.rules` nega tudo por padrão e permite somente o dono de `users/{uid}`. Valida campos permitidos/obrigatórios, tamanhos, tipos, enumerações, referências dentro da mesma conta, centavos, datas civis reais, intervalos, revisão sequencial e timestamps de servidor. Perfil não pode ser excluído pelo cliente para não deixar filhos sem ciclo de limpeza.

`firestore.indexes.json` tem listas vazias: consultas usam ordenação pelo ID de documento dentro do UID, sem índices compostos necessários. Não criar índices especulativos.

O teste de regras cobre leitura/listagem, criação, atualização/exclusão cruzadas A/B, anônimo, UID forjado, mudança de owner, campos administrativos, timestamps, remoção de campos, strings excessivas, tipos/valores inválidos, órfãos e referências. O repositório testa CRUD, centavos, reabertura, preferência e conflito real. Chromium testa popup Google simulado, cancelamento, CRUD, reidratação, duas contas, offline, temas e demo em desktop/mobile.

O runner Node usa `--test-force-exit` após todos os testes e hooks de cleanup: conexões internas do SDK mantêm handles abertos após o relatório final. Falhas dos testes continuam retornando código não zero; o flag não ignora testes nem assertions.

**Limite da evidência:** emuladores não comprovam OAuth do Google em produção, duas contas Google reais, Safari/iOS ou cotas reais. Ver status/evidências no roadmap. Artefatos de QA são mantidos por sete dias no Actions. Não marcar testes planejados como executados.

## Deploy GitHub Actions

`deploy-pages.yml` valida PR/push/dispatch: instalação congelada, domínio, TypeScript, builds Firebase/Pages, emuladores e navegador. Somente master fora de PR publica Pages.

`deploy-firebase.yml` aguarda sucesso do workflow CI após push na master, faz checkout **do SHA validado**, confere o ID DEV e publica regras, índices e Hosting. Dispatch manual somente na master executa os testes completos novamente antes de publicar. Environment final: `firebase-development`; o antigo nome `firebase-production` não identificava um projeto PROD e não é usado no workflow novo.

Configuração de repositório reaproveitada:
- Variable `FIREBASE_PROJECT_ID=roteiva-web-dev`, validada por igualdade.
- Secret `FIREBASE_SERVICE_ACCOUNT`, somente em etapa de autenticação após validação.
- Conta existente `roteiva-github-deploy-dev@roteiva-web-dev.iam.gserviceaccount.com`.

Papéis existentes auditados: Firebase Hosting Admin e API Keys Viewer. Com autorização explícita do proprietário em 16/10/2026, adicionados Firebase Rules Admin (`roles/firebaserules.admin`) e Cloud Datastore Index Admin (`roles/datastore.indexAdmin`) somente no projeto DEV. Estes não dão acesso de leitura/escrita aos documentos, mas permitem alterar a segurança e os índices. Não conceder Editor/Owner/Firestore User por conveniência. WIF é uma melhoria futura: elimina chave persistente, mas exige pool, provider e binding IAM restrito ao repo/master; não criar outro mecanismo de credenciais sem auditoria e autorização.

O comando explícito é:
```bash
pnpm exec firebase deploy --only firestore:rules,firestore:indexes,hosting --project roteiva-web-dev --non-interactive
```

O Hosting serve dist/, fallback SPA /index.html e cache longo somente para assets versionados. Nenhum comando tem projeto PROD ou cria projeto/banco. Auth foi configurado no Console e não é sobrescrito no deploy.

## QA real restante

Entrar/sair/reabrir com Google no DEV, repetir com segunda conta autorizada, conferir foto/nome/e-mail, permissão cruzada real, tema claro/escuro e desktop/mobile; testar atualização direta de /review. Emuladores e verificações de build não substituem isso.


## Auditoria Firebase DEV — antes das alterações (16/10/2026)

Inspeção da master `4fbd5fdf86c793c386ff42f6b6e5d696ebf51fb5` e Console autenticado:

| Recurso | Estado observado |
|---|---|
| Projeto | Exclusivamente `roteiva-web-dev`, número 533435008961, plano Spark |
| Hosting | Ativo; release `043ce6`, 16/10/2026 19:27 (Brasília), conta `roteiva-github-deploy-dev@roteiva-web-dev.iam.gserviceaccount.com` |
| Domínios Hosting | `roteiva-web-dev.web.app` e `roteiva-web-dev.firebaseapp.com` |
| Aplicativo Web | Nenhum aplicativo registrado |
| Authentication | Não inicializado; Console apresenta “Vamos começar”; Google ainda não habilitado |
| Domínios Auth | Ainda não verificados, dependem da inicialização |
| Firestore | Nenhum banco criado; região/modo ainda não definidos |
| Frontend | React 19/Vite 8/TS; sem SDK Firebase; localStorage com chave preservada |
| Deploy Firebase | Workflow manual, environment denominado firebase-production, usa variável FIREBASE_PROJECT_ID e segredo FIREBASE_SERVICE_ACCOUNT; apenas Hosting |
| Pages | Workflow PR/push master; testes de calendário/finanças, typecheck e ambos builds; publicação somente fora de PR |
| Divergências | README/arquitetura/roadmap/desenvolvimento ainda dizem Hosting sem deploy; nome do environment é ambíguo para DEV |

**BLOQUEADO:** criação do banco até aprovação explícita da região permanente. Proposta: Standard, `(default)`, `southamerica-east1` (São Paulo), Production Mode, Spark. Sem Blaze, backups pagos, Functions, Storage, PROD ou importação de demo.

Implementação e validação Auth/Firestore permanecem **PLANEJADAS** nesta auditoria. Credencial privada existente não foi lida nem copiada. WIF depende de auditoria IAM e não será alterado por conveniência.

### Resultado do provisionamento aprovado

Em 16/10/2026 o proprietário aprovou explicitamente Standard, São Paulo e Spark. Criado `(default)`, `southamerica-east1`, nativo, Production Mode inicialmente deny-all; sem backups pagos. Authentication inicializado e somente Google habilitado com nome público Roteiva DEV e e-mail de suporte do proprietário. Domínios confirmados como os dois Firebase e localhost; nada extra adicionado. App Web Roteiva Web DEV registrado, appId `1:533435008961:web:c197c1076bc0e7b151d140`; SDK público em .env.firebase. Não criado bucket Storage.
