# Desenvolvimento e deploy — Roteiva

[README](../README.md) · [Arquitetura](ARCHITECTURE.md) · [Roadmap](MVP-ROADMAP.md).

React 19/Vite 8/TypeScript, sem SSR, Next/Vinext ou Functions. API Worker/D1 DEV independente em api/ (PR #15). Node 22.13+, PNPM 11.25.0 e Java 21 para emuladores. Frontend com `pnpm-lock.yaml`; API independente com `api/package-lock.json`. Instalação congelada obrigatória em ambos.

## Comandos

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Dependências travadas |
| `pnpm dev` | Demo Vite sem login |
| `pnpm dev --mode firebase` | DEV Firebase (config pública em .env.firebase / overrides .env.local) |
| `pnpm test` | Agenda, dinheiro e mensagens de falha do login |
| `pnpm typecheck` | TypeScript sem emissão |
| `pnpm build` | Firebase explícito → dist/ |
| `pnpm build:demo` | Demo de QA local → dist-demo/ (sem deploy público) |
| `pnpm build:emulator` | Firebase fictício → dist-emulator/ |
| `pnpm exec playwright install chromium` | Navegador de teste |
| `pnpm test:rules` | Firestore Emulator: regras, isolamento A/B e repositório (sem navegador) |
| `pnpm test:firebase` | Regressão completa: regras + Playwright desktop/mobile |
| `node scripts/verify-static-build.mjs dist /` | SPA e assets Firebase |
| `node --test tests/firebase-ops.test.mjs` | Contrato de operações administrativas, sem credenciais |

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

Domínios autorizados: `roteiva-web-dev.web.app`, `roteiva-web-dev.firebaseapp.com`, `localhost` (desenvolvimento). A demo local não é domínio de login. Não há escopos Drive. Redirecionamento OAuth automático não foi adicionado: exige validação específica de armazenamento entre origens e mobile. Safari/iOS e navegadores embutidos devem ter QA real antes de divulgação ampla.

O cache do Firestore é habilitado automaticamente e revalidado com revisão/contagens por UID antes de reaproveitar coleções persistidas. O logout tenta limpar a persistência; abas extras podem impedir essa limpeza e devem ser fechadas. Nenhuma migração da demo. Carregamento sob demanda por rota; Projetos e Clientes usam páginas de até 24 e cursor Firestore; Projetos traz as tarefas de cada página e Clientes carrega projetos completos para contadores; demais domínios completos usam blocos internos de até 200; exportação exige todos os domínios; sem listeners globais. Atualizações concorrentes de um mesmo documento são rejeitadas pela revisão, com recuperação explícita. Atualizações independentes não regravam coleções inteiras. Uma transação limita alterações simultâneas a 350 documentos para reservar espaço às revisões; pacotes de entregas permitem até 100 itens.

Exportação JSON/CSV preservada. O JSON reflete os dados carregados e não inclui mídia. Ao perder rede/permissão ou ocorrer conflito, o painel oferece recarregar a nuvem, descartando alterações não confirmadas. Uma navegação enquanto grava dispara aviso de saída.

## Regras e testes

`firestore.rules` nega tudo por padrão e permite somente o dono de `users/{uid}`. Valida campos permitidos/obrigatórios, tamanhos, tipos, enumerações, referências dentro da mesma conta, centavos, datas civis reais, intervalos, revisão sequencial e timestamps de servidor. Perfil não pode ser excluído pelo cliente para não deixar filhos sem ciclo de limpeza.

`firestore.indexes.json` tem listas vazias: consultas usam ordenação pelo ID de documento dentro do UID, sem índices compostos necessários. Não criar índices especulativos.

O teste de regras cobre leitura/listagem, criação, atualização/exclusão cruzadas A/B, anônimo, UID forjado, mudança de owner, campos administrativos, timestamps, remoção de campos, strings excessivas, tipos/valores inválidos, órfãos e referências. O repositório testa CRUD, centavos, reabertura, preferência e conflito real. Chromium testa popup Google simulado, cancelamento, CRUD, reidratação, duas contas, offline, temas e demo local em desktop/mobile.

O runner Node usa `--test-force-exit` após todos os testes e hooks de cleanup: conexões internas do SDK mantêm handles abertos após o relatório final. Falhas dos testes continuam retornando código não zero; o flag não ignora testes nem assertions.

**Limite da evidência:** emuladores não comprovam OAuth do Google em produção, duas contas Google reais, Safari/iOS ou cotas reais. Ver status/evidências no roadmap. Artefatos de QA são mantidos por sete dias no Actions. Não marcar testes planejados como executados.

## CI/CD por responsabilidade — revisão de 18/10/2026

O Roteiva **não publica mais GitHub Pages**. O ambiente DEV segue no Firebase Hosting (frontend) e Cloudflare Worker/D1 (API). Os deploys não dependem de um workflow principal nem de uma suite Playwright de vários minutos.

| Workflow | PR | Push na master | Manual/agendado |
|---|---|---|---|
| `frontend.yml` | `pnpm test`, typecheck e build | Repete validação e publica **somente Hosting** no DEV | Dispatch opcional na master |
| `api.yml` | typecheck, testes Worker/D1, migrações locais e dry-run | Repete validação, aplica migrações D1 remotas e publica Worker DEV | Dispatch opcional na master |
| `firebase-infra.yml` | Regras no emulador, isolamento A/B | Revalida e publica **somente rules/indexes** | Dispatch opcional na master |
| `qa-regression.yml` | Não executa em todo PR | Não bloqueia publicação rápida | Manual ou toda noite, Playwright desktop/mobile + emuladores |
| `preview.yml` | Sem auto deploy com secrets em PR | Não publica | Dispatch na master com número de PR interno; build sem secrets, canal Hosting temporário |
| `account-deletion-monitor-dev.yml` | — | — | A cada 15 min, executa monitoramento separado da exclusão |
| `firebase-ops.yml` | — | — | Dispatch na master com credencial administrativa separada, **somente quando repo privado** |

**Segurança das mudanças críticas:** PRs alterando `firestore.rules`, `src/data/**`, auth e workspace disparam validação Firestore no emulador. Ao mexer em exclusão permanente, autenticação sensível, autorização ou Drive OAuth, execute manualmente `qa-regression.yml` e confira o resultado antes do merge, independentemente de o CI rápido passar. Testes E2E não foram removidos, apenas deslocados.

O pipeline `firebase-infra.yml` faz deploy de rules/indexes somente quando um push inclui esses caminhos/arquivo de workflow; alterações em serviços de dados acionam a validação relevante no PR. Não existe deploy de rules/indexes em cada atualização visual. Se houver necessidade de publicação manual da infraestrutura, use o dispatch na master, não a pipeline de frontend.

**Segredos/variáveis já existentes em DEV:** `firebase-development` recebe `FIREBASE_PROJECT_ID=roteiva-web-dev` e `FIREBASE_SERVICE_ACCOUNT`; `cloudflare-development` recebe `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` e `CLOUDFLARE_API_TOKEN`. IDs são conferidos antes de acessar provedores. Builds de PR não têm acesso a credenciais. O deploy do Worker usa seu `api/package-lock.json` e executa migrações versionadas antes do release. Commits obsoletos são bloqueados antes de publicar.

**Preview reutilizável:** em Actions > Firebase preview (manual PR) > Run workflow, escolha `master` e informe o número de uma PR **interna** aberta contra master. O job de build valida o PR via GitHub, sem credenciais e publica o artefato; o job de deploy usa código confiável da master e o canal `pr-N`, que expira em 7 dias. Somente o frontend vai para o canal, nunca Worker, Firestore rules/indexes nem dados. Canais podem exigir autorização do domínio em Firebase Auth/CORS; preview não é certificação de integração Google Drive.

### Operações Firebase via GitHub

O projeto está **público**. Por isso `firebase-ops.yml` tem guard obrigatório de visibilidade privada e fica efetivamente **bloqueado no estado atual**. Não existem dados de clientes em logs públicos. O GitHub app conectado pode executar o workflow por dispatch depois que as pré-condições estiverem habilitadas. Para ativar sem vazar dados, torne o repositório privado ou isole os workflows administrativos num repositório privado, configure environment `firebase-data-development` com `FIREBASE_PROJECT_ID=roteiva-web-dev`, `FIREBASE_DATA_OPS_ENABLED=true` e `FIREBASE_DATA_SERVICE_ACCOUNT` de privilégios mínimos (Firestore leitura + fixtures DEV quando necessário). Essa identidade **não** deve reutilizar `FIREBASE_SERVICE_ACCOUNT` do deploy. Nunca registrar credenciais em Vite.

`scripts/firebase-ops.mjs` suporta `read` para documentos sob `users/{uid}`, `count` para coleções sob um usuário e `create-fixture`/`delete-fixture` sob `opsFixtures/{id}`. Acesso a coleções comerciais é **somente leitura** neste primeiro contrato. Escritas de cliente/projeto/financeiro exigem operações de domínio com validação de esquema, revisão e stamp sincronizados; o script **rejeita patches genéricos** que quebrariam a integridade. Caminhos são validados e limitados; no caso de leitura, o resultado só pode ser visto em logs de **repositório privado**. Inputs de Actions não devem conter valores pessoais.

### Preparação PROD, ainda não provisionado

`.env.production.example` e `firebase.prod.example.json` são modelos não executáveis sem IDs reais. O Cloudflare Worker PROD ainda precisará de conta/banco D1/segredos OAuth distintos, callbacks próprios, ambiente protegido, migrações e validação de smoke tests. **Nenhum workflow publica PROD**, e não devemos apontar PROD para recursos DEV. Meta de deploy comum até 60s será avaliada em runs reais; filas externas, testes de segurança e migrações podem ultrapassá-la.

### Firebase Hosting cache

O Hosting DEV serve `dist/`, reescreve links profundos para `/index.html` e mantém HTML sem cache e `/assets/**` versionados com cache imutável. Os testes `tests/firebase-hosting-cache.test.mjs` e `scripts/verify-hosting-cache.mjs` verificam o contrato após publicação. A infraestrutura permanece no plano Spark (sem provisionar cobrança).

## Franquias e consumo

Projeto mantido no Spark, sem vincular cobrança. Firestore Standard: um banco gratuito por projeto, 1 GiB, 50.000 leituras/dia, 20.000 escritas/dia, 20.000 exclusões/dia e 10 GiB de saída/mês; a renovação diária segue aproximadamente meia-noite do Pacífico. Referência: [cotas oficiais](https://firebase.google.com/docs/firestore/quotas). TTL, backup, PITR, restore e clone não foram habilitados.

Sem consentimento de cache, a Visão Geral busca agenda e atividades completas, até quatro projetos recentes com suas tarefas e agregações de clientes, finanças pendentes e etapas de projetos, além do perfil, preferência e documento de revisões. Para contas com até quatro projetos e a primeira página completa, as contagens de etapas são calculadas a partir dos documentos recebidos, sem quatro agregações extras. Projetos busca 24 itens por página (e suas tarefas), com filtro de status no servidor; Clientes busca 24 registros por página, com contagem agregada de recorrentes, e carrega projetos para exibir relacionamentos corretos. A busca textual aciona carga completa em ambas. Financeiro lê somente o mês selecionado para manter totais, despesas, origem das receitas e CSV corretos; o gráfico anual consulta até doze somas agregadas por faixa de data, com índices `kind/date` e `clientId/kind/date`, ou reutiliza uma leitura completa quando há até 40 lançamentos. Agenda lê mês anterior, atual, próximo e quatro eventos posteriores para o quadro de próximos compromissos. Uma transação financeira pode recalcular apenas o mês afetado no gráfico anual. Consultas por faixa **não** consideram o domínio completo para revisões, cache ou exclusões. A primeira visita de uma conta antiga sem revisões requer sete consultas de contagem para inicializar o stamp. Com cache consentido e completo, consulta a revisão remota por UID e reutiliza documentos armazenados quando todos os domínios estão válidos; do contrário relê somente domínios inválidos. Mutações passam a gravar `sync/state` na mesma transação, portanto há custo adicional de uma escrita de revisão por mutação. Regras podem acrescentar leituras de documentos dependentes. Transações fazem leituras antes das escritas e podem repetir em conflito. Paginação das listas de Projetos e Clientes limita inicialmente a 24 registros; Financeiro e Agenda limitam as leituras por período, com paginação técnica interna de 200 documentos por consulta. Um mês muito movimentado ainda será lido integralmente para manter seus totais e CSV exatos; isso **não** representa paginação de 24 por vez no histórico Financeiro. Esses limites exigem medição e eventual agregação materializada se o volume mensal crescer muito. Os indicadores agregados são cobrados por entradas de índice e podem custar mais que documentos em contas pequenas; comparar no Console do Firebase. Sem listeners globais ou polling; ao retomar a aba, a revisão remota é conferida com intervalo mínimo e alterações externas bloqueiam a edição até recarga explícita. Sem sincronização em tempo real ou mídia no Firestore. O histórico da UI fica limitado aos últimos 150 itens. O painel de Configurações expõe contadores *diagnósticos locais por sessão*, incluindo consultas, documentos recebidos e alterações, e não deve ser confundido com cobrança. Para medir custo faturável real, comparar **Firestore Usage** e métricas do Google Cloud, em mesma janela e com conjunto de dados semelhante, antes/depois do deploy. Índices, regras, retries e operações mínimas de agregação alteram a cobrança. Os emuladores/CI não comprovam essas métricas de faturamento, e o Spark pode interromper operações no limite.

Login Google não usa SMS nem Identity Platform avançado. Hosting entrega apenas SPA estática e assets, sem Functions/App Hosting; franquias de 10 GB de conteúdo e 10 GB de transferência/mês. Ao atingir o teto, Spark pode impedir deploy ou suspender o site até renovação; conferir [uso e limites do Hosting](https://firebase.google.com/docs/hosting/usage-quotas-pricing). GitHub Actions executa testes contra emuladores fictícios, sem consumir documentos do DEV. Franquias não são promessa de capacidade ilimitada.

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

### Evidência automatizada da PR #6

[Run 38980915291](https://github.com/EwertonMendes/roteiva-web/actions/runs/38980915291), commit 3eb037a: instalação congelada, testes de calendário/financeiro/autenticação, TypeScript, build Firebase e Pages, 12 testes Firestore/repositório e 8 testes Chromium passaram. Browser cobre OAuth simulado pelo Auth Emulator, cancelamento, CRUD, centavos, agenda após reload, sessão/tema, duas contas, offline e demo, em desktop e Pixel 7 emulado. Relatório HTML e capturas no artefato firebase-qa (retenção de 7 dias). A publicação e o OAuth real devem ser conferidos depois do merge; não são comprovados por este run.

### Publicação DEV e IAM final

PR #6 mergeada em 4ce6847. [CI master](https://github.com/EwertonMendes/roteiva-web/actions/runs/38981508561) passou, publicou Pages e acionou [deploy DEV](https://github.com/EwertonMendes/roteiva-web/actions/runs/38981719389), concluído na tentativa 2 em 16/10/2026 às 20:33 de Brasília: regras compiladas/publicadas, índices aplicados e 15 arquivos do Hosting publicados exclusivamente em roteiva-web-dev. O primeiro deploy retornou 403 ao consultar serviceusage.services.get. O proprietário aprovou Service Usage Viewer; após concessão, o mesmo commit foi republicado com sucesso. Nenhuma API nova ou cobrança foi habilitada por esse ajuste.

Chrome confirmou a tela de login do DEV, ausência de workspace anônimo, recuperação do cancelamento do popup e demonstração Pages sem login. A rota direta /review entrega a SPA e exige autenticação. O endpoint reservado /__/auth/handler responde. Após tentativas pelo controle automatizado ficarem em carregamento/cancelamento, um fluxo iniciado e concluído manualmente no Google abriu o painel. Conferidos nome/e-mail/foto, workspace inicialmente vazio, criação de cliente/projeto/tarefa/agenda e lançamento R$ 100,01 identificados por [QA]. Recarregar restaurou sessão, vínculos, tarefa, agenda de 16/10/2026 às 09:00–10:00, valor e tema claro. A segunda conta, logout/relogin e dispositivos reais continuam em verificação; isolamento adversarial está comprovado pelos testes de regras nos emuladores.

### PR #7 — /review e regressão de teste mobile

[PR #7](https://github.com/EwertonMendes/roteiva-web/pull/7) corrige o rótulo do portal `/review` no DEV autenticado e o contraste do cartão sem criar portal de aprovação real. Testes Playwright passaram a conferir `/review` e o retorno ao painel.

O CI inicial falhou no mobile emulado ao tentar preencher `Nova tarefa` **fora da área visível**, sem valor ao final da chamada Playwright `.fill()`. O teste agora rola até o input, foca e digita via teclado. Não houve mudança funcional no formulário. O [CI 38984055813](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984055813) passou as 12 verificações Firestore/repositório, oito testes de navegador desktop/mobile, TypeScript e builds Firebase/Pages. A publicação DEV do ajuste e a inspeção com autenticação real continuam distintas dos testes em emuladores.

Permanecem pendentes logout/relogin com Google real, isolamento visual com segunda conta Google real e Safari/iOS ou aparelho móvel físico. Os testes A/B de regras não dispensam essas verificações.

### PR #7 — Release comprovada, sem QA real presumido

A PR #7 foi incorporada à master pelo [commit c11532e](https://github.com/EwertonMendes/roteiva-web/commit/c11532e9daf47c581eae4deea944a990fb83ecae). O [CI de PR 38984302906](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984302906) e o [CI master 38984541920](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984541920) passaram integralmente, incluindo 12 testes Firestore/repositório e oito Playwright desktop/mobile emuladores. O workflow [Firebase DEV 38984744995](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984744995) publicou o mesmo commit com sucesso; Pages também foi publicado na master.

A rota `/review` autenticada foi **validada em navegador automatizado contra emuladores**, com rótulo DEV e retorno ao painel. A inspeção visual autenticada diretamente no site publicado **ainda não foi comprovada**. Não declarar concluídos logout/relogin com conta Google real, isolamento com segunda conta Google real, Safari/iOS ou aparelho móvel físico.

Esses testes devem ser executados sem apagar os registros `[QA]` já existentes e sem conceder acesso entre contas.

## Cadastro separado — PR #9

O modo Firebase verifica a existência de `users/{uid}` via `getDocFromServer` após o login Google, sem criar perfil silenciosamente. `src/features/auth/RegistrationGate.tsx` separa as contas existentes do primeiro acesso e trata falha de rede sem considerar a conta inexistente. `RegistrationPage.tsx` cadastra nome profissional, estúdio opcional e perfil de atuação e exige reconhecimento explícito do armazenamento de dados DEV. Uma transação Firestore cria o documento somente após o envio; várias abas não sobrescrevem os dados existentes. Timestamps de registro são imutáveis e as regras mantém compatibilidade com documentos legados.

**Teste de regressão indispensável:** os usuários de antes da PR #9 devem entrar sem onboarding e manter cadastros e preferências; a demo Pages nunca deve carregar Firebase; criar identidade Auth não pode criar automaticamente o documento de perfil. Um UID sem perfil não acessa coleções protegidas. Não afirmar conclusão de aceite legal: política e termos finais para o produto público continuam pendentes. Validação automatizada em emuladores é distinta do teste com Google real.

Para teste visual, conferir fluxos `Entrar`, `Criar conta`, conta ausente, voltar/sair sem registro, checkbox obrigatório, contraste dos temas, teclado, mobile/desktop, restauração de sessão e `/review` protegido. O fluxo do registro só é publicado no DEV após a pipeline de testes.

## Configurações do perfil e estúdio — PR #11

Em `Configurações`, o usuário autenticado pode editar seu nome, estúdio/marca e tipo de atuação, ou mudar o tema (persistido em `preferences/ui`). Os campos `email` e `photoURL` são provenientes da conta Google e permanecem somente leitura. O topo e a lateral mostram o nome do estúdio gravado em `users/{uid}`.

A função `saveProfile(changes, expectedRevision)` valida os campos, lê o documento em transação, compara a revisão e atualiza apenas os campos editáveis; em conflito, exibe orientação para atualizar a página. `RegistrationGate` carrega a versão do servidor e atualiza o contexto somente **após** confirmação de gravação, não aplica alterações otimistas. Contas antigas mantêm `registrationCompletedAt` e `dataAcknowledgedAt` ausentes; ao personalizar o estúdio, registram apenas nome, tipo de atuação e revisão.

As regras Firestore proíbem alterações de UID, e-mail/foto, timestamps de cadastro e campos administrativos. O QA deve incluir conta antiga, conta nova, tentativa cruzada de edição, atualização concorrente, nome no cabeçalho, recarga da página, tema e preservação de projetos. O GitHub Pages continua sem gravação no Firebase.

A opção de exportação JSON reutiliza o componente existente e **não garante backup de registros que não foram carregados**; não inclui mídia, segredos nem autenticação. Exclusão de conta e tratamento LGPD/termos são **pendências** do beta, não recursos falsamente anunciados.

## Rotas e comportamento do navegador — PR #12

A tabela de rotas está em `src/lib/workspace-routing.ts`. O Firebase Hosting mantém seu rewrite SPA `** → /index.html` e serve as URLs de seção e detalhe diretamente. `DashboardClient` extrai a tela e o ID da URL antes da primeira renderização; ao navegar, usa `pushState` e no histórico usa `popstate`. `/review` continua uma rota à parte em `src/main.tsx`; o layout, os dados e o login não são duplicados.

Como o GitHub Pages é estático e não oferece fallback correto para subrotas, a build em modo `demo` usa `/roteiva-web/#/clientes` e `/roteiva-web/#/projetos/:id`, com o mesmo módulo e a mesma chave de `localStorage`. Não adicionar roteador pesado nem dependência nova apenas para essa navegação, e não fazer URL limpa no Pages sem infraestrutura de fallback.

**Testar:** `pnpm test` inclui `tests/workspace-routing.test.mjs`. `pnpm test:firebase` também cobre F5, links diretos, Back/Forward, IDs existentes/inexistentes, login com rota salva e outra conta Google no Auth Emulator, além da demonstração hash em desktop/mobile. O parser de rotas não lê nem autoriza documentos; as Security Rules Firestore permanecem a fronteira de permissão. Após logout explícito, um link de detalhe da sessão anterior sai da barra de endereço. Manter essa validação ao adicionar novas seções.

### Recuperação transparente de leituras Firestore (PR #14)
O carregamento inicial e as leituras por rota executam retentativas limitadas somente para erros transitórios do Firestore (rede indisponível, prazo excedido, aborto ou erro interno), seguidas por reconexão automática em segundo plano. Consultas otimizadas que falham por índice pendente ou argumento não suportado podem usar, de forma excepcional, a leitura completa da coleção sob as mesmas regras por UID e revisões, preservando totais e integridade. O fallback não é um retorno de zeros e não desativa regras de segurança. O usuário não recebe prompt para repetir leituras. Falhas determinísticas repetidas param de reiniciar indefinidamente; autenticação/permissão e cota permanecem erros explícitos.

**Atenção:** gravações sem confirmação não são repetidas automaticamente. A tela de recuperação manual só pode ser usada nesse cenário para evitar duplicação ou descarte silencioso de alterações locais. Testes de regressão: `firestore-recovery.test.mjs`, fluxo Playwright offline/reconexão desktop/mobile e `firestore.rules.test.mjs`. A causa exata de erros de rede em dispositivos físicos só é determinável por código de erro/diagnóstico de sessão; não registrar conteúdo privado de documentos.

## API Google Drive / Cloudflare DEV — PR #15

O código e o lockfile da API ficam em `api/`. O frontend mantém PNPM e seu lockfile existente. A API usa npm com dependências exatas e package-lock próprio, evitando alterar o pipeline Firebase/Pages. Tudo pode rodar no Actions, sem instalação no computador do usuário.

### Recursos e consoles

| Recurso | Identificador / console |
|---|---|
| Conta Cloudflare existente | [b3855f9c192541a01a45b2dae7b6a7f8](https://dash.cloudflare.com/b3855f9c192541a01a45b2dae7b6a7f8/workers-and-pages) |
| Worker novo DEV | [roteiva-api-dev](https://dash.cloudflare.com/b3855f9c192541a01a45b2dae7b6a7f8/workers/services/view/roteiva-api-dev/production) |
| HTTPS estável | https://roteiva-api-dev.ewertonmendes9.workers.dev |
| D1 novo DEV | [roteiva-drive-dev — 302adc88-76b2-4827-bb16-99662fa0408b](https://dash.cloudflare.com/b3855f9c192541a01a45b2dae7b6a7f8/workers/d1/databases/302adc88-76b2-4827-bb16-99662fa0408b/metrics) |
| Projeto Google novo | [roteiva-drive-dev — 479738001561](https://console.cloud.google.com/home/dashboard?project=roteiva-drive-dev) |
| APIs ativadas | [Drive](https://console.cloud.google.com/apis/api/drive.googleapis.com/metrics?project=roteiva-drive-dev), [Picker](https://console.cloud.google.com/apis/api/picker.googleapis.com/overview?project=roteiva-drive-dev) |
| Consentimento separado | [Google Auth Platform](https://console.cloud.google.com/auth/audience?project=roteiva-drive-dev), Externo / Testing, proprietário como usuário de teste |
| Cliente web novo | [Clientes OAuth](https://console.cloud.google.com/auth/clients?project=roteiva-drive-dev), Roteiva Drive DEV Backend |
| GitHub environment novo | [cloudflare-development](https://github.com/EwertonMendes/roteiva-web/settings/environments/24586792750/edit) |
| Firebase reutilizado | roteiva-web-dev, identidade e negócio; não usado como projeto OAuth Drive |
| PROD | Não criado |

Origem JavaScript autorizada: `https://roteiva-web-dev.web.app`. Callback exato: `https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback`. O Pages permanece demo sem login nem acesso ao Worker. Não adicionar localhost, wildcard, domínio Bem Feito ou callback do Firebase ao cliente de Drive por conveniência.

### Configuração e secrets

`wrangler.jsonc` mantém base sem publicação e somente `env.dev` com binding DB e IDs reais. Os guards de runtime recusam ambiente/projeto/origem/callback divergentes. Não existe comando deploy PROD. Na PR #17, `OAUTH_ENABLED=true` é habilitado exclusivamente no Worker DEV (Google OAuth Testing e usuários autorizados) para permitir a PoC real. Revogar a ativação por commit e deploy se o fluxo falhar ou houver risco; não habilitar PROD.

| Nome | Destino / finalidade |
|---|---|
| GOOGLE_CLIENT_ID | Wrangler vars; identificador público do cliente web dedicado |
| GOOGLE_CLIENT_SECRET | Worker Secret DEV; troca/renovação OAuth |
| TOKEN_KEYS | Worker Secret DEV; JSON de versões para chaves AES-256 base64url; valores nunca documentados |
| TOKEN_KEY_VERSION | Wrangler vars; versão usada em novas cifragens, inicialmente v1 |
| FIREBASE_PROJECT_ID | Wrangler vars; roteiva-web-dev |
| FRONTEND_ORIGIN / OAUTH_REDIRECT_URI | Wrangler vars; allowlist e retorno exato |
| ENVIRONMENT / OAUTH_ENABLED | Wrangler vars; dev e gate de integração |
| CLOUDFLARE_API_TOKEN | GitHub environment secret cloudflare-development |
| CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID | GitHub environment variables; IDs conferidos antes de migrations/deploy |

Secrets inseridos diretamente pelos formulários oficiais. Chave AES gerada com CSPRNG, 32 bytes. Não ficam em GitHub, VITE_*, artefatos, logs, URLs ou .env versionado. O token Cloudflare `roteiva-dev-github-deploy` foi autorizado com **Workers Scripts:Edit + D1:Edit somente na conta acima**, expira em **15/01/2027**. A interface só limita essas permissões por conta: pode alterar outros Workers/D1 nessa conta, não apenas Roteiva. Não inclui billing, DNS, zona, perfil, tokens, R2 ou acesso global. Se futuramente forem exigidas permissões adicionais, auditar erro antes de conceder. A conta não possuía Workers/D1 antes desta tarefa.

Rotação AES: gerar nova chave por destino seguro, adicionar versão mantendo as antigas no secret, mudar TOKEN_KEY_VERSION, recriptografar registros por procedimento auditado com revisão e AAD, verificar todas as versões remanescentes; só depois remover chave antiga. **Não há job automático de recriptografia nesta fundação**. Perder a chave obriga reconectar as contas. Rotação OAuth/CI: criar substituta nos mecanismos oficiais, atualizar destino seguro, validar, revogar a anterior; não usar código/Actions para imprimir material secreto. Backup/recuperação e retenção precisam ser definidos antes do piloto.

### Comandos válidos na pasta api

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
npm run typecheck
npm test
npm run migrate:local
npm run build
npm run migrate:dev
npm run deploy:dev
```

Os quatro últimos que usam Wrangler dependem do runtime oficial instalado pelo runner; migrations remotas e deploy exigem token no environment. `build` é dry-run, não publicação. Migrations remotas são versionadas pelo D1; nunca editar arquivo já aplicado, criar próximo número. Usar mudanças aditivas compatíveis com versão anterior do Worker; não automatizar DROP/rollback destrutivo. DB guarda somente conexão, ciphertext e transação temporária; nenhum cliente/projeto/mídia.

`api-dev.yml` valida PRs, dispatch e conclusão bem-sucedida do CI frontend após push master: instalação congelada, audit, typecheck, testes, migração local e dry-run. Publicação normal só após CI frontend verde de push master (workflow_run) ou dispatch manual na master com validação própria; checkout do SHA validado, após validate; serializa migrations/deploy, confere conta/banco e testa HTTPS e rejeição de identidade inválida. Checkout/artifact do mesmo run; token somente nas etapas privilegiadas. Firebase/Pages permanecem workflows originais. O bootstrap inicial foi executado por dispatch explícito do proprietário, branch exata e SHA esperado, com validação repetida. A exceção foi removida do workflow e o environment passou a aceitar somente master após a publicação; versões históricas da branch também não recebem mais esse secret. Não fazer merge automático.

### Contratos mínimos

| Rota | Comportamento |
|---|---|
| GET /health | SELECT mínimo no ledger de migrations, status/environment sem IDs ou dados privados; 503 se dependência falha |
| GET /integrations/drive | Bearer Firebase, apenas resumo das conexões do próprio UID |
| POST /oauth/drive/start | Bearer Firebase + Origin exata, retorna launchUrl para navegação top-level; sem Set-Cookie cross-site |
| GET /oauth/drive/launch | Consome ticket efêmero de uso único, define cookie HttpOnly Secure SameSite=Lax em primeira parte e redireciona para Google |
| GET /oauth/drive/callback | State/cookie/TTL/PKCE/nonce; 303 para biblioteca com resultado categórico |
| GET /integrations/drive/:connectionId/about | Bearer Firebase + proprietário; solicita somente o nome/e-mail do Drive após refresh do token, não retorna credenciais |
| GET /integrations/drive/:connectionId/metadata?fileId=... | Só metadado de arquivo autorizado, sem bytes/mídia; refresh no servidor |
| POST /integrations/drive/:connectionId/disconnect | Origem exata e proprietário; revogação Google explícita, sem apagar arquivos |

Migrations `0001_oauth.sql` e `0002_oauth_launch.sql` são aditivas e versionadas. O rate limiter da origem é por endereço recebido da borda Cloudflare, não uma chave única compartilhada por todos os usuários; existe também limiter por UID. O frontend futuro deve redirecionar a janela principal para `launchUrl` (nunca carregar via fetch/iframe). O ticket é uma capacidade de uso único; não guardar a URL em logs. Validar cookies no Chrome/Safari antes de habilitar a integração. Rotas OAuth/metadados/desconexão bloqueadas enquanto OAUTH_ENABLED=false. Na PR #17, a habilitação de DEV permite testes reais do fluxo: abrir Biblioteca no Firebase DEV, clicar Conectar Google Drive, concluir consentimento na conta Google autorizada, confirmar retorno a /biblioteca?drive=connected e clicar Testar acesso (Drive about.get via refresh no backend). Verificar estado após F5, logout/login e duas sessões. A demo Pages nunca recebe o painel. A tela Conectar Drive foi adicionada na PR #17 e o primeiro consentimento real encontrou uma falha categórica no callback; consultar a seção de recuperação adiante. A validação completa e bibliotecas continuam pendentes. Callback não retorna tokens; respostas privadas no-store, no-referrer e sem conteúdo executável. Não registrar exceções, requests, URLs, cookies ou respostas OAuth. Invocation logs desabilitados para impedir retenção de code/state no callback; logs categóricos com requestId, amostragem 10%, sem traces nem exportação para terceiros.

### Franquias e pendências de operação

Console Cloudflare confirmou Free: 100.000 requests/dia, D1 10 bancos/5 GB de conta, 5 milhões de linhas lidas/dia e 100 mil escritas/dia; banco Free até 500 MB. Limites duros podem interromper API, sem upgrade automático. CPU limitada pelo próprio plano Free (10 ms); a API Cloudflare recusou configurar cpu_ms explicitamente no Free, portanto esse campo foi removido sem upgrade; medir JWT/WebCrypto no Free com tráfego real. Rate limiter 60/minuto por chave de agregado/UID por local Cloudflare; não garante orçamento global em ataques distribuídos. Ver [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) e [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Nenhum plano pago, billing ou recurso PROD foi habilitado.

Google Testing com drive.file normalmente emite refresh tokens que expiram em sete dias; não prometer validade permanente. In production elimina essa limitação específica, mas tokens continuam sujeitos a revogação, inatividade, limites e políticas de conta. Não publicar para contornar testes: revisar domínio, marca, homepage, privacidade/termos públicos, escopos mínimos, suporte, exclusão/retenção e verificação aplicável. drive.file é não confidencial na classificação Google; escopos restritos ampliam obrigações e podem exigir avaliação de segurança. Ver [expiração OAuth](https://developers.google.com/identity/protocols/oauth2#expiration) e [escopos Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Picker requer futuramente chave de API **pública restrita a HTTP referrer DEV e somente Picker API**, appId do projeto e token curto adequado. A API está habilitada, mas a UI Picker e essa chave não foram criadas nesta fundação. Seleção de pasta não concede acesso recursivo aos arquivos existentes. Originais permanecem no Drive; biblioteca/associação de múltiplas pastas serão outra etapa.

**QA obrigatório antes de habilitar a integração:** login real A/B, consentimento/revogação/renovação reais, arquivo autorizado pelo Picker, concorrência e cookies entre sites. Mocks de Google e JWTs sintéticos não contam como essas evidências. API REST não valida revogação Firebase imediatamente; documentar janela de expiração antes de piloto. Sem chave em VITE_*, sem refresh token devolvido ao cliente.

### Evidência de publicação em 17/10/2026

[Run DEV 39055895154](https://github.com/EwertonMendes/roteiva-web/actions/runs/39055895154) publicou o commit `0d8d7bc99cf615603bddd6e0d78a246a5ff07d45`: npm ci/audit, TypeScript, oito testes, migration local, dry-run, aplicação idempotente da migração remota, deploy e smoke HTTPS concluídos. Health real retornou 200 com status ok/environment dev; token inválido retornou 401. Conferido também no Chrome. A primeira tentativa [39055742987](https://github.com/EwertonMendes/roteiva-web/actions/runs/39055742987) já havia aplicado 0001_oauth.sql, mas a publicação foi recusada porque cpu_ms configurável não é suportado no Free; remoção do campo resolveu sem upgrade. Logs não contêm secrets, e a tela do Worker confirmou os dois secrets cifrados preservados após deploy. Projeto Google confirmado sem conta de faturamento vinculada.

OAuth real, renovação real, arquivo real selecionado e segunda conta Google **não executados**. O grant Drive nunca foi concedido nem há refresh token real armazenado. Infraestrutura funcional não equivale a biblioteca ou PoC Google validada.

Validação HTTPS independente após deploy: health 200, conexões sem identidade 401, callback desabilitado 503, rota inexistente 404, Origin não autorizado 403 sem CORS e OPTIONS da origem DEV 204 com allowlist exata. Firebase DEV e Pages retornaram HTTP 200 com HTML Roteiva. Essas leituras HTTP não validam login/CRUD real dos frontends.

### Recuperação do retorno Google — `offline_consent_required`

O primeiro teste manual do OAuth no Chrome chegou ao callback e apresentou `offline_consent_required` com JSON no navegador. O código anterior agregava três causas diferentes (refresh ausente, ID token ausente, `scope` não informado/sem `drive.file`). A correção separa erros categóricos, valida o escopo informado, faz consulta autenticada `Drive about.get` antes de gravar credenciais e permite reutilizar o refresh token cifrado **somente** da mesma conta já conectada. Primeiro acesso sem refresh token retorna `offline_access_unavailable` e requer novo consentimento/recuperação da autorização no Google. O callback usa redirect `303` para a Biblioteca, sem expor credenciais. Testes de integração usam respostas Google simuladas; o próximo teste precisa confirmar a autorização real. O OAuth segue Google Testing.

### Teste do fluxo único Google Drive/pastas

1. Acesse `https://roteiva-web-dev.web.app/biblioteca` autenticado e selecione um projeto no seletor superior.
2. Se não conectado, clique **Conectar Google Drive**. O Google apresenta de uma só vez permissão de arquivos específicos e leitura de arquivos existentes; aceite somente em conta Google de teste. Se conectado com permissão antiga `drive.file`, clique **Vincular pastas**, que inicia a atualização de permissão no mesmo fluxo.
3. Depois do retorno `?drive=connected`, a UI restaura o projeto selecionado e abre automaticamente o seletor. Navegue por Meu Drive/Todas as pastas, subpastas, clique **Vincular** em várias pastas e feche o seletor.
4. Clique **Ver arquivos** em uma pasta vinculada. Confirme listagem paginada, subpastas, prévia Google e o link de fallback **Drive**; arquivos e pastas originais continuam na conta Google.
5. Desvincule uma pasta e valide que arquivos originais não foram apagados. Teste refresh, reload, duas contas diferentes, regras Firestore e bloqueio de permissão no Cloudflare.
6. Verifique a integração completa com consentimento real e QA Chrome/Safari/mobile. Mocks e CI sozinhos não atestam a concessão de escopo restrito. Antes de abrir ao público, concluir a verificação exigida pelo Google para `drive.readonly`.

O deploy Firebase DEV precisa publicar `firestore.rules` e Worker DEV. Nenhuma credencial Google pessoal é armazenada em `sessionStorage`, URL ou Firestore.

## Laboratório temporário de tipografia — DEV (outubro/2026)

A barra superior do ambiente DEV possui um seletor **Fonte (teste)**. Mantemos **Ubuntu (atual)** como referência, além de 10 famílias gratuitas carregadas remotamente via Google Fonts CSS2, somente quando selecionadas: Manrope, Plus Jakarta Sans, DM Sans, Instrument Sans, Geist, Sora, Space Grotesk, Outfit, Inter e Onest. Nenhuma nova fonte foi baixada ou adicionada ao repositório. Fontes remotas exigem rede e podem falhar sob bloqueios de privacidade; nesses casos a fonte anterior continua aplicada e o controle informa a falha.

- Componente e flag para desativar: `src/features/typography/TypographyLab.tsx` (constante `TEMPORARY_FONT_LAB_ENABLED`).
- Estilos temporários e contraste do menu nativo: `src/features/typography/font-lab.css`.
- Montagem na topbar: `src/dashboard-client.tsx` (somente ambiente autenticado, não na demonstração Pages).
- Importação isolada dos estilos: `src/main.tsx`.
- A escolha é guardada apenas em `sessionStorage`, não no Firebase nem no armazenamento permanente do usuário; voltar para Ubuntu remove o override CSS. O experimento não altera as definições tipográficas oficiais do tema.
- Remoção definitiva: retirar componente/imports na topbar e main, deletar os dois arquivos. Não há migrações ou dados de negócio.
- Teste Playwright: `tests/browser/font-lab.spec.ts`, com mock do CSS remoto apenas no teste, verificando os 11 itens, troca imediata, persistência na sessão, reset e contraste dos options em claro/escuro.

O seletor não altera ainda a escala de tamanhos do produto: decidir a família primeiro, depois refatorar a hierarquia tipográfica e legibilidade sem testes contaminados por mudanças simultâneas.

## Otimização dos access tokens Drive (17/10/2026)

Migration aditiva `api/migrations/0003_access_token_cache.sql`; aplicar antes do Worker novo com o workflow normal. Não apagar conexões nem editar migrations antigas. As colunas novas são ignoradas pelo Worker antigo; após rollback, nova revisão impede reutilizar cache de credencial antiga. Banco/Secrets/escopos existentes preservados. Sem instalação local ou nova plataforma.

O cache usa AES-GCM, TTL real de expires_in com margem de 60s, lease SQL de 20s, espera limitada de 8s e cooldown de 2s em falha (5s se houve token rotacionado sem publicação). Não há cron: renovação só sob demanda. Não ampliar validade do Google. Uma desconexão/reconexão invalida cache no D1; não usar cache HTTP, localStorage ou Map global para credenciais.

Comandos mantidos: npm ci --ignore-scripts, npm audit --audit-level=high, npm run typecheck, npm test, npm run migrate:local, npm run build. Testes novos usam SQLite real em memória, as três migrations, AES-GCM real e endpoints Google simulados. Cobrem reutilização, margem, concorrência, takeover/fencing, isolamento A/B/conta/ambiente, rotação, reconexão/desconexão em voo, invalid_grant, cooldown e retry de GET em 401. Isso não representa grant Google real nem medição de latência de produção.

QA DEV: abrir a Biblioteca com conexão existente, navegar entre pastas/recarregar, conferir ausência de novas telas de consentimento e eventos hit após o primeiro refresh_succeeded; verificar logs por janela sem capturar dados privados. Aguardar expiração real ou usar somente credenciais sintéticas nos testes; nunca adulterar tokens reais para provar expiração. Conferir desconexão/reconexão voluntária e manter os arquivos no Drive. Métricas de economia reais dependem do uso DEV após publicação. Respostas 403 de arquivo/cota não pedem reconexão automaticamente.

Rollback de código não remove a migration. Rotação de chaves deve considerar os access tokens cifrados: eles podem ser descartados e reconstruídos a partir do refresh token; não remover uma chave ainda usada por refresh tokens. A operação GET pode terminar se já enviada antes da revogação; futuras aquisições consultam status/revisão no D1.


Publicação DEV da PR #25 após incorporar a master/PR #24: commit `bf69a4a6d8943c85d186ac75da71996806ddaaa3`, [workflow bem-sucedido](https://github.com/EwertonMendes/roteiva-web/actions/runs/39083667469), Worker version `ee816c74-1acb-4e2c-978c-a29c14979516`. Migration 0003 aplicada remotamente na primeira publicação; health 200 e identidade inválida 401 verificados pelo deploy. CI frontend do mesmo commit verde e 36/36 testes API. Workflow normal restaurado, sem merge automático. QA com conta Google real e medição de economia continuam pendentes para o proprietário.

### Falha Google Drive `google_unavailable` após cache de tokens (#25)

No DEV, a leitura real de `/integrations/drive/:id/folders` e `/folders/:id/items` retornava 502 `google_unavailable`, enquanto a conta D1 permanecia `connected` e os vínculos do Firestore continuavam presentes. A PR #25 substituiu o acesso simples por cache/lease e introduziu `redirect:'error'` em todos os GETs de metadados Google; qualquer resposta HTTP 3xx do provedor pode disparar uma rejeição indistinguível de falha de rede. O consentimento prévio e as pastas vinculadas não devem ser apagados para investigar isso.

Correção: os GETs do Drive usam `redirect:'manual'` e podem seguir **até dois** redirecionamentos somente para `https://www.googleapis.com/drive/v3/` e `https://content.googleapis.com/drive/v3/`, com checagem de URL e bloqueio explícito de `alt=media`. O bearer nunca é encaminhado automaticamente para outro host. O POST OAuth token também passa a usar `redirect:'manual'`, **bloqueando** redirecionamentos para impedir envio automático do client secret e refresh token. Erros de transporte, timeout, resposta OAuth e redirecionamento ganham códigos distintos, apresentados sem dados sensíveis. Há testes com redirecionamento permitido, host malicioso, loop e sigilo de credenciais.

**QA DEV exigido:** acompanhar CI + deploy do Worker; repetir `Vincular pastas` e `Ver arquivos` com a conta real e confirmar listagem correta ou nova categoria segura. O teste simulado não comprova a origem do 502 nem a operação real. Não revogar conexão, atualizar token manualmente nem eliminar vínculos. Observar logs categóricos sem valores brutos de tokens. Falha residual exige diagnóstico do estágio exato (OAuth token vs Drive GET) sem especulação.

### Cache local automático e Zona de perigo

O cliente Firebase utiliza `persistentLocalCache({tabManager:persistentMultipleTabManager()})` automaticamente, sem chave/opt-in do usuário. A persistência é separada por projeto e a leitura de coleções em cache é condicionada ao manifesto local por UID, revisão remota (`getDocFromServer` em `sync/state`) e contagem exata. O SDK pode recuar para memória se IndexedDB não estiver disponível. Não utilizar o cache como fonte de verdade quando offline: pedidos de dados atuais devem passar pela validação da nuvem e erros seguem o mecanismo de recuperação já existente. Ao sair ou excluir a conta, os manifestos são invalidados antes de tentar limpar o IndexedDB; fechar outras abas pode ser necessário para limpeza integral. As opções de cache/exportação foram retiradas de Configurações; a API interna de exportação continua no domínio, sem ser exposta como backup integral. Exclusão definitiva permanece em `Zona de perigo` com confirmação rigorosa.


## Biblioteca Drive: miniaturas privadas e preview (PR de 18/10/2026)

A lista de itens do Google Drive já solicita `thumbnailLink`, `mimeType`, `modifiedTime` e `webViewLink`. O frontend agora utiliza as miniaturas para lista/grade com `IntersectionObserver`, limite de 4 downloads simultâneos e cache apenas em memória (máximo 48 URLs de objeto; liberadas na troca de conta, desconexão e saída da página). O modo lista/grade é preferência local não sensível. Documentos não renderizáveis continuam com ícones por MIME, e a prévia de arquivos aproveita o Google Drive iframe com botão externo e navegação teclado/setas.

O endpoint `GET /integrations/drive/:connectionId/files/:fileId/thumbnail` exige Firebase ID Token e status de conta ativo, limita requisições, confirma que a conexão pertence ao UID e possui escopo `drive.readonly`, consulta metadados no Google Drive e seleciona somente `thumbnailLink` fornecido pelo servidor. O Worker recusa URL de cliente, redirecionamento e hosts fora de Google/Googleusercontent; recusa tipos que não sejam imagem e limita 1 MiB por resposta. Nunca consulta `alt=media` nem faz proxy de vídeo/original. Resposta marcada `no-store`, sem persistência binária em D1/Firestore. Se o Google não fornecer thumb ou a prévia externa falhar, o item mantém ícone e opção Abrir no Drive. Autenticação deve continuar testada com uma conta real em DEV, inclusive thumbnails de vídeos/PDFs privados. A origem CORS do Worker segue DEV principal (preview channels não têm acesso à API); validar após deploy integrado.


### Drive performance (18/10/2026)

- Metadados de pastas e resultados de busca ficam somente na memória do navegador, por UID, conexão, pasta, termo e página (máximo 24 entradas; 30 segundos para frescor). Ao reabrir uma pasta, dados recentes são exibidos imediatamente. Dados antigos são revalidados em segundo plano; logout, troca de conta, desconexão ou erro de permissão invalidam o cache. Nenhum nome ou conteúdo privado fica em localStorage.
- `files.list` e `files.get` da pasta rodam em paralelo. A listagem retorna para cada miniatura um **ticket AES-GCM de 90 segundos** contendo metadados autenticados e URL Google; o Worker valida UID, conexão, revisão e expiração antes de buscar a imagem, evitando repetir `files.get` por miniatura. Tickets não são URLs públicas e nunca são persistidos.
- O endpoint antigo sem ticket permanece como fallback autenticado para expiração ou dados legados. Miniaturas ficam apenas na memória, com fila de até seis requisições e prioridade para itens visíveis; abortadas na troca de conta.
- O CORS OPTIONS validado não consome rate limit. Requests normais usam 60/min; miniaturas têm binding próprio `API_THUMB_LIMIT` de 240/min, com limites separados por IP e UID. Em DEV, `wrangler.jsonc` configura ambos.
- A busca local é imediata e a busca remota ocorre após 280ms com o parâmetro `search` limitado e escapado; consulta apenas os filhos da pasta atual, com paginação. A busca não é recursiva.
- Métricas agregadas `drive_folder_list`/`drive_thumbnail` registram duração, quantidade, bytes e modo (ticket/fallback), sem IDs, nomes, tokens ou URLs pessoais. Validar p50/p95 em ambiente DEV real; a meta de 1s não é uma garantia externa.

### Correção de compatibilidade de miniaturas (19/10/2026)
A listagem privada passou a retornar `thumbnailTicket` no lugar de `thumbnailLink`, mantendo este último apenas como fallback legado. O frontend deve verificar os dois formatos antes de iniciar o loading. Teste unitário do contrato com ticket somente, mais E2E desktop (PDF + imagem sem miniatura, token na query, loading, sucesso e fallback). Sem retornar a exibir links Google no DOM. A API existente permanece inalterada.

## Migração do controle de acesso DEV

O workflow API DEV executa `node scripts/check-access-migration.mjs --before`, `npm run migrate:dev` e `node scripts/check-access-migration.mjs` no diretório `api/`, com segredo Cloudflare do ambiente protegido. Não executar verificador remoto em branches. O snapshot local contém somente contagens e é ignorado pelo Git. Divergência interrompe deploy para investigação; manter migration aditiva aplicada. Não usar a conta de deploy Firebase para operações de dados. Sequência completa em [ACCESS-CONTROL.md](ACCESS-CONTROL.md).

Fase 2: `ACCESS_PROVISION_ON_DRIVE=true` em `api/wrangler.jsonc` ativa apenas o provisionamento validado sob demanda para sessões anteriores à UI nova. Falha de IAM/projeção retorna erro; nunca concede por ausência de estado. Migration 0008 fixa datas; não editar após aplicar. Cron faz uma conta por minuto e para após cursor completo. Auditar por contagens e status em access_rollout, sem imprimir cursor, UID ou documentos. Não desativar a flag até concluir inventário e publicação do frontend. Não publicar as regras restritivas da PR #42 junto desta fase.

Frontend integrado: `node scripts/check-access-worker.mjs` é executado antes do Hosting pelo workflow oficial; falha se Worker não expõe versão 1 ou se `/access/ensure` não nega identidade ausente. Não contornar esse gate. `pnpm build:demo` é QA local, sem publicação Pages. Validação completa: `pnpm build:emulator`, `pnpm build:demo`, `pnpm test:firebase` com Java 21 e Chromium.

Ativação final (**concluída na PR #48**): `ACCESS_PROVISION_ON_DRIVE=false` foi publicada após cobertura e UI confirmadas; as regras restritivas foram publicadas exclusivamente pelo workflow Firestore com testes automatizados A/B. O merge dessa entrega é um gate operacional, não autorização para ignorar backfill/homologação. Não usar patch ad hoc nas Security Rules em caso de falha.

Mutações privilegiadas futuras exigem sync_pending=1 antes de negar a projeção/alterar ledger; liberar somente após verificar D1 e Firestore. ensure/Drive negam a conta durante pendência. Não fazer UPDATE avulso de suspensão/concessão em conta real, nem remover grants para revogar. O app ADM continuará separado; esta entrega só fornece a fence de segurança e protocolo.

Estado publicado: PR #48 aplicou 0009 e ACCESS_PROVISION_ON_DRIVE=false pelo run API 39358435356; regras finais pelo run 39358435474. Não reativar compatibilidade por falhas de autenticação do browser. Cadastro/login, suspensão e cortesia descartáveis confirmados; pedido de exclusão descartável **aceito após login manual recente**, porém conclusão da saga ainda não confirmada. Expiração e isolamento A/B remotos permanecem pendentes. Evidências e pendências em ACCESS-CONTROL.md.
