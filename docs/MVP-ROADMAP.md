# Roadmap vivo — Roteiva MVP

**Atualização inicial: 16/10/2026.** Este é o documento **obrigatório** de acompanhamento por humanos e IAs. Arquitetura em [ARCHITECTURE.md](ARCHITECTURE.md). Entrega de cada PR deve revisar status, critérios, evidência e bloqueios (ver [AGENTS.md](../AGENTS.md)).

## Convenções de status

- **VALIDADO:** implementado, critérios de aceite verificados, com evidência de teste/PR.
- **IMPLEMENTADO:** existe no código, mas falta validação integral.
- **PARCIAL:** UI, lógica ou parte da integração existe; não utilizável de ponta a ponta.
- **PLANEJADO:** ainda não implementado.
- **BLOQUEADO:** há dependência ou problema técnico especificado.

**Regra:** uma página ou botão não significa funcionalidade operacional. Nunca marcar uma etapa concluída por uma proposta ou por uma build que apenas compila. Ao mudar status, acrescentar PR/commit, testes e observações de regressão.

## Fase preliminar — Higienização do repositório

**Objetivo:** remover arquivos demonstravelmente não utilizados **sem refatorar o funcionamento** nem apagar o backend legado.

- [x] Auditar árvore do repositório e imports das principais entradas da demo/app.
- [x] Retirar UI genérica gerada e sem referência, exemplos D1 do template, ícones padrão, logos experimentais e arquivos auxiliares associados.
- [x] Guardar o arquivo-fonte vetorial da marca fora de `public/`; manter fontes, logotipo em uso, favicon e licenças necessárias.
- [x] Adotar PNPM como instalador único e eliminar o `package-lock.json` conflitante; preservar `pnpm-lock.yaml`.
- [x] Preservar frontend Next.js/Vinext durante a limpeza do backend na PR #4; **decisão posterior na PR #5: migrar para React/Vite estático** para Firebase Hosting, mantendo a UI.
- [x] Reduzir dependências/lockfile à stack React/Vite/TS/Tailwind; validar instalação congelada, testes, typecheck e builds Firebase/Pages na PR #5.
- [x] Remover `app/api/**`, Drizzle/D1, R2, auth de host e conectores de backend antigos, sem alterar componentes/estilos do frontend (PR #4).
- [x] Preservar a demo original na PR #4 e migrar explicitamente para frontend único Vite na PR #5, sem SSR e sem duas aplicações concorrentes.
- [x] Implementar autenticação e persistência novas no escopo Solo DEV da PR #6, sem reutilizar backend antigo.

**Aceite da migração frontend da PR #5:** pipeline com `pnpm install --frozen-lockfile`, testes de calendário/financeiro, `tsc --noEmit`, build base `/` com saída `dist/`, build base `/roteiva-web/` com saída `dist-pages/`; Firebase SPA rewrite e assets essenciais verificados. Avaliação visual em desktop/mobile após publicação continua necessária.

**Evidência:** [PR #3](https://github.com/EwertonMendes/roteiva-web/pull/3) (arquivos removidos, diff e validação automatizada).

## Panorama de hoje

| Componente | Situação | Evidência/limitação |
|---|---|---|
| Interface, páginas e estados locais | **IMPLEMENTADO para demo local** | `src/dashboard-client.tsx` e `src/studio-features.tsx`, sem backend; UI preservada |
| Demonstração GitHub Pages | **VALIDADO — publicado após PR #6** | Mesmo frontend `src/`, build `dist-pages/`, `localStorage` |
| Testes de calendário/financeiro | **IMPLEMENTADO** | `tests/studio-calendar.test.mjs`, `tests/studio-finance.test.mjs`; executados no CI do Pages |
| API antiga e D1/R2 | **REMOVIDO do código ativo** | PR #4; frontend Next/Vinext preservado; backend futuro será novo |
| Firebase Hosting | **VALIDADO na auditoria prévia** | DEV Spark atualizado após CI master 38981508561 e deploy 38981719389 |
| Firebase Auth e Firestore | **IMPLEMENTADO na PR #6; QA em andamento** | Console DEV configurado, regras e persistência por UID; evidências abaixo |
| Worker API separado e D1 de tokens | **PARCIAL — PR #15** | Fundação e recursos DEV; PoC real e biblioteca pendentes |
| Drive individual por usuário | **PLANEJADO** | Integração BRBET inspecionada externamente; não transferida |
| Revisão segura por cliente | **PLANEJADO** | Fluxo legado incompatível com arquitetura-alvo |
| Planos/entitlements | **PLANEJADO** | Não há verificação server-side de assinatura |

## Evolução de onboarding — cadastro separado (PR #9)

**Status: VALIDADO no CI da PR #9; deploy DEV somente após merge.**

- [x] Diferenciar **Entrar** e **Criar conta** mantendo Google como único login.
- [x] Não criar perfis Firestore em login ou restauração de sessão; apenas depois da confirmação do formulário.
- [x] Consultar perfil existente sem escrita, preservar usuários antigos e dados das PRs #6–8.
- [x] Criar formulário responsivo com nome, estúdio opcional, tipo de trabalho e ciência do uso de dados no ambiente DEV, sem inventar Termos/Política formais.
- [x] Regras: exigir dados completos em novos perfis, timestamps imutáveis, manter compatibilidade para contas existentes e negar acesso entre UIDs.
- [x] Preservar a demonstração sem Firebase e a chave `localStorage`.
- [x] [CI PR #9 — run 38987657544](https://github.com/EwertonMendes/roteiva-web/actions/runs/38987657544): instalação congelada, testes de domínio, TypeScript, builds Firebase/Pages, **12 testes Firestore/repositório** e **10 Playwright desktop/mobile** (incluindo conta sem perfil, cadastro explícito, saída sem registro e perfis existentes).
- [ ] Publicar após CI verde e verificar fluxo real no DEV sem afetar registros existentes; testes Google reais e aparelhos físicos ainda pendentes.
- [ ] Antes de abrir cadastro público: providenciar e revisar Termos de Uso, Política de Privacidade, canal de suporte e processo de exclusão de conta/dados.

**Escopo:** separação entre identidade Google e cadastro de negócio. Não confundir checkbox DEV com aceite jurídico definitivo.

## Configurações da conta e do estúdio — PR #11

**Estado: VALIDADO no CI da PR #11, publicação DEV pendente do merge.**

- [x] Criar uma tela de configurações alinhada à identidade visual do Roteiva, responsiva e com temas claro/escuro.
- [x] Permitir editar nome profissional, nome do estúdio e tipo de atuação, com Firestore revisionado e validação.
- [x] Exibir nome cadastrado do estúdio em vez de `Roteiva Studio`, com fallback para perfis sem marca.
- [x] Preservar conta antiga, dados existentes e timestamps do cadastro, e-mail/foto Google somente leitura.
- [x] Reutilizar tema salvo e exportação JSON dos dados carregados, com limitações explícitas.
- [x] Estender Security Rules para edição restrita ao UID e preservar registro e identidade.
- [x] [CI da PR #11 — execução 38992248908](https://github.com/EwertonMendes/roteiva-web/actions/runs/38992248908): instalação congelada, testes de domínio, TypeScript, builds Firebase/Pages, testes de segurança e persistência com Firebase Emulator, Playwright Chromium desktop/mobile aprovados.
- [ ] Merge, deploy DEV e conferência com conta Google real.
- [ ] Futuro: eliminação segura de conta, exportação integral e políticas legais antes do beta público.

**Não implementa Drive, cobrança, edição de conta Google ou exclusão irreversível.**

## Navegação por URL e restauração de tela — PR #12

**Status: VALIDADO no CI da PR #12; publicação DEV após merge.**

- [x] URLs próprias para as sete seções do dashboard além da visão geral, incluindo Configurações.
- [x] URLs estáveis de detalhes de projeto e cliente, restauradas após F5 sem recarregar a tela inicial.
- [x] Navegação Voltar/Avançar com `pushState`/`popstate` e links diretos com Firebase Hosting SPA rewrite existente.
- [x] GitHub Pages usa rotas `#/...`, mantendo o mesmo frontend e a persistência local da demonstração.
- [x] Preservar `/review` protegido e impedir renderização de dados alheios a partir de um ID na URL.
- [x] Limpar a rota privada ao sair e voltar à lista quando um ID não pertence à conta.
- [x] Testes unitários do parser/URL e Playwright de refresh, histórico, isolamento e demo.
- [x] [CI PR #12 — execução 38994449773](https://github.com/EwertonMendes/roteiva-web/actions/runs/38994449773): parser/URLs, TypeScript, builds Firebase e Pages, regras/persistência Firebase e **14 testes Playwright** desktop/mobile; confirmado F5, URLs de detalhes, Voltar/Avançar, login direto, isolamento A/B e demo hash. Primeira rodada encontrou sincronização da gravação antes do F5, corrigida e revalidada.
- [ ] Merge, deploy DEV e conferência manual do F5 em uma conta Google real.

**Decisão:** URLs com pathname no Firebase e fragmento/hash no Pages, para funcionar sem criar um backend ou um mecanismo de fallback HTTP falso.

## Fase 0 — Prova técnica mais arriscada: Google Drive + Worker

**Prioridade P0.** Fazer **antes** de migrar a biblioteca completa, para validar que é possível usar Drive com segurança e arquivos grandes sem proxy.

- [x] **VALIDADO — PR #15:** Worker TypeScript publicado em DEV/Free; [run 39055895154](https://github.com/EwertonMendes/roteiva-web/actions/runs/39055895154), health HTTPS real. PoC Drive autenticada segue pendente.
- [ ] PoC de verificação segura de Firebase ID Token no Worker; rejeitar tokens inválidos, expirados e de outro projeto.
- [ ] OAuth 2.0 Google no Worker com `drive.file`, `state`, offline access e callback seguro; testar expiração, reconexão, revogação, troca de conta.
- [ ] D1 DEV com refresh token cifrado via WebCrypto/AES-GCM e chave em Workers Secrets; isolamento e não exposição.
- [ ] Criar pasta Drive gerenciada por usuário e listar arquivos que o app está autorizado a acessar.
- [ ] Testar upload de vídeo grande direto navegador→Drive com progresso, cancelamento/retry, sem atravessar Worker; comparar sessão resumable vs access token curto conforme [arquitetura](ARCHITECTURE.md).
- [ ] Testar dois usuários Google independentes: usuário A **não** lê ou opera Drive/token de B.
- [ ] Testar permissão de vídeo privado concedida e retirada para conta revisora.
- [ ] Decidir oficialmente organização de pastas/importação e fluxo de acesso do revisor; registrar resultados e limites.

**Aceite:** duas contas reais de teste independentes; upload de arquivo acima de 250 MB; reconexão e revogação reproduzíveis; falhas e CORS documentados; nenhum refresh token visível no browser/log; recursos dentro das franquias. Se falhar, marcar **BLOQUEADO** e replanejar o fluxo, não implementar gambiarra.

**Estado:** PLANEJADO. **Dependência:** projeto Google Cloud com consent screen em teste, Firebase DEV e conta Cloudflare DEV.

## Fase 1 — Fundação SaaS e ambientes

**Prioridade P0.** Por solicitação explícita na PR #6, Auth/Firestore Solo são independentes da PoC Drive da Fase 0. Fundação Worker/D1 DEV adicionada na PR #15; OAuth real e biblioteca continuam pendentes.

- [x] Unificar React/Vite/TS na SPA em `src/`, mantendo visual, estado local e build Pages; preparar build Firebase em `dist/` (PR #5).
- [x] Padronizar lockfile/instalação com PNPM, removendo o npm lock e instaladores órfãos (higienização PR #3); **a auditoria de dependências em si continua pendente**.
- [x] Reutilizar exclusivamente Firebase **DEV** roteiva-web-dev: Hosting ativo, Auth Google habilitado, Firestore Standard criado em São Paulo após aprovação. **PROD não autorizado e não criado**.
- [x] Implementar login Google, logout, sessão, proteção e erros na PR #6; **IMPLEMENTADO**, QA real ainda pendente.
- [ ] Criar cliente HTTP para Worker, com Firebase ID Token e tratamento de expiração/401; sem compartilhar UID arbitrário.
- [ ] **PARCIAL — PR #15:** Worker DEV, secrets/bindings e CORS implementados/publicados; PROD separado, não autorizado nem provisionado.
- [x] CI com typecheck, testes, ambos builds e emuladores; deploy DEV automático após master verde (PR #6).
- [ ] Acrescentar lint e previews; PROD continua separado e não provisionado.
- [ ] Configurar observabilidade de erros/cotas e documentação de configuração/deploy.
- [ ] Testar mobile, desktop, tema e navegação acessível.

**Aceite:** dois usuários entram em contas distintas, reiniciam sessão, veem telas protegidas; regras verificam identidade; Worker DEV tem fundação na PR #15; PROD continua futuro; CI verde. **Estado:** PARCIAL — fundação Solo implementada, QA e demais subetapas discriminados abaixo.

## Fase 2 — Dados persistentes e isolamento

**Prioridade P0.** Dependente da Fase 1.

- [x] Contratos, IDs aleatórios seguros, datas civis ISO e moeda persistida em centavos (PR #6); sem índices compostos exigidos.
- [x] Decisão Solo: users/{uid} e subcoleções privadas, ownerUid imutável, deny-by-default (PR #6). Workspaces compartilhados são futuros.
- [x] Repositório por documento para clientes, projetos, tarefas, entregas, agenda, finanças, atividades e preferências (PR #6).
- [x] Persistência por registro, leitura paginada e estados vazios/erros na PR #6; exclusões somente onde a UI já oferece a operação.
- [x] Revisão por documento detecta conflito; recuperação explícita descarta rascunho. Sem fila offline/importação da demo (PR #6).
- [x] Regras e integração nos emuladores: 12 cenários passaram, incluindo CRUD A/B, UID/owner/role, timestamps, schema, valores, referências e conflito (PR #6).
- [ ] Implementar exportação e procedimento de exclusão de conta/dados pessoais (mídia continua no Drive, por padrão).
- [ ] Medir leituras/gravações para limitar custos.

**Aceite:** cadastros persistem entre dispositivos da mesma conta, alterações refletem corretamente, usuário B não lê/escreve dados de A, e campos de plano/papel são negados. **Estado:** PARCIAL — integração e testes automatizados implementados; QA real e medição de uso ainda pendentes.

## Fase 3 — Gestão operacional de ponta a ponta

**Prioridade P0.** Depende da Fase 2.

- [ ] Clientes recorrentes/avulsos: contatos, pacotes, validações e histórico.
- [ ] Projetos: cliente, briefing, prazos, etapas, templates, tarefas e entregas.
- [ ] Agenda: eventos de gravação, reunião, entrega, aprovação, vínculo e aviso de conflito.
- [ ] Financeiro: receitas/despesas, centavos, parcelamento, filtros, status, resumos e CSV.
- [ ] Painel: indicadores com consultas eficientes e cálculo consistente; funcionamento mobile.
- [ ] Testes de cálculos, datas, permissões, edição concorrente e navegação.

**Aceite:** freelancer conclui ciclo cliente→projeto→tarefa→agenda→financeiro, fecha e reabre sessão sem perda de dados. **Estado:** PARCIAL — UI existente integrada à fundação DEV; produção e piloto completo ainda pendentes.

## Fase 4 — Biblioteca Drive de verdade

**Prioridade P0/P1.** Dependente da PoC e das Fases 1–3.

- [ ] Integrar estado da conexão, reconexão, troca de conta e desconexão ao frontend.
- [ ] Pasta gerenciada `Roteiva` por proprietário + opção de importar arquivos específicos pelo Google Picker (sujeito à decisão da PoC).
- [ ] Listagem, metadados, filtros, vínculos por projeto, arquivos órfãos e erros de permissão.
- [ ] Upload resumable direto ao Drive, progresso/retry/cancelamento e validação de conclusão antes de gravar no Firestore.
- [ ] Versionamento sem perda de cortes anteriores; identificar arquivo por Drive file ID, não nome.
- [ ] Visualização/download autorizado e tratamento de arquivo apagado/movido externamente.
- [ ] Teste com arquivos reais grandes, rede instável e principais navegadores/dispositivos.
- [ ] Não armazenar arquivos do usuário em R2/Firebase Storage/D1/Firestore por padrão.

**Aceite:** duas contas enviam arquivos grandes e veem apenas seus ativos, versão antiga persiste, reconexão funciona, uso de banda do Worker não acompanha tamanho do arquivo. **Estado:** PLANEJADO.

## Fase 5 — Revisão segura e feedback de clientes

**Prioridade P1.** Dependente da Fase 4.

- [ ] Definir fluxo de convite autenticado com Google, por entrega e versão; validado com profissional real.
- [ ] Vincular concessão de acesso no Firestore à permissão real do Google Drive para a conta revisora.
- [ ] Exibir vídeo via visualizador/preview compatível; fallback para abrir no Drive se incorporação falhar.
- [ ] Implementar comentários por timestamp manual, status da revisão e histórico de decisões.
- [ ] Permitir solicitar alterações, aprovar e enviar nova versão mantendo rastreabilidade.
- [ ] Revogar convite e acesso ao arquivo (Firestore + Drive), tratando falhas parciais.
- [ ] Testar acesso indevido, expiração, reenvios, formatos não reproduzíveis e mobile.

**Aceite:** um profissional compartilha uma versão somente com cliente autorizado, cliente comenta e aprova, owner acompanha retorno e consegue revogar integralmente. **Estado:** PLANEJADO.

**Fora do aceite do MVP:** player proprietário com timeline controlada, comentário automático no ponto pausado, revisão anônima por link, transcodificação e streaming próprio.

## Fase 6 — Pronto para piloto comercial

**Prioridade P1.** Dependente de fluxos core concluídos.

- [ ] Controle de plano server-side e restrições reais; ativação manual por administrador inicialmente.
- [ ] Limites e proteção contra uso abusivo; monitoramento de cotas gratuitas.
- [ ] Política de privacidade, termos de uso, orientações de LGPD, exportação/exclusão e suporte mínimo.
- [ ] Revisar direitos de reutilização do antigo BRBET antes de copiar qualquer código/asset.
- [ ] Testes completos de onboarding/desconexão/usuário A vs B e restauração de erros.
- [ ] Revisar acessibilidade, performance, estados de erro, mobile, documentação e release checklist.
- [ ] Realizar piloto com **2–10 usuários reais**, coletar feedback e custo por usuário.
- [ ] Validar fluxo de venda e suporte antes de automatizar assinatura.

**Aceite:** usuário externo consegue entrar, conectar Drive, cadastrar cliente, produzir projeto, receber revisão e encerrar sem intervenção técnica; segurança validada e sem vazamento entre contas; custos monitorados. **Estado:** PLANEJADO.

## Depois do MVP (não bloquear lançamento)

- [ ] Equipes e papéis de estúdio; faturamento e convites avançados.
- [ ] Pagamento recorrente, gateway/webhooks e provisionamento automático de planos.
- [ ] Player controlado com timeline e comentários sincronizados, sujeito à viabilidade de mídia.
- [ ] Links públicos de revisão sem login, com autorização temporária e controles antiabuso.
- [ ] Notificações, relatórios avançados, PWA offline e outras integrações de storage.

## Registro contínuo de alterações — preencher a cada PR

| Data | PR / commit | Etapa | Status novo | Evidência e pendências |
|---|---|---|---|---|
| 16/10/2026 | [PR #1](https://github.com/EwertonMendes/roteiva-web/pull/1) | Demonstração Pages | Build/deploy validados; backend não implementado | CI build/testes calendário+finanças; demo localStorage |
| 16/10/2026 | [PR #2](https://github.com/EwertonMendes/roteiva-web/pull/2) | Organização documental | Estrutura/arquitetura propostas registradas | Somente Markdown; **não** altera funcionalidades |
| 16/10/2026 | [PR #3](https://github.com/EwertonMendes/roteiva-web/pull/3) | Higienização | Scaffold removido; PNPM padronizado | Pipeline Pages passou |
| 16/10/2026 | [PR #4](https://github.com/EwertonMendes/roteiva-web/pull/4) | Limpeza backend | APIs antigas, D1/R2/Drizzle retirados; Next/Vinext preservados naquela etapa | Testes e deploy Pages aprovados |
| 16/10/2026 | [PR #7](https://github.com/EwertonMendes/roteiva-web/pull/7) | Ajuste `/review` e QA DEV | VALIDADO no CI e publicado em DEV | CI PR 38984302906, CI master 38984541920 e deploy DEV 38984744995; testes Google reais A/B e mobile físico pendentes |
| 16/10/2026 | [PR #6](https://github.com/EwertonMendes/roteiva-web/pull/6) | Firebase DEV Solo | IMPLEMENTADO; automação VALIDADA | [CI 38980915291](https://github.com/EwertonMendes/roteiva-web/actions/runs/38980915291); 12 regras/repositório + 8 browser; CI master e deploy concluídos; OAuth real em uma conta confirmado; segunda conta em andamento |
| 16/10/2026 | [PR #5](https://github.com/EwertonMendes/roteiva-web/pull/5) | Migração React/Vite | Next/Vinext removidos a pedido, Vite único, Firebase Hosting configurado | Validar CI com TypeScript, testes e dois builds; Firebase deploy aguarda projeto/segredos |

### Protocolo para IAs

1. Ao começar, localizar a fase e suas dependências; reler decisões abertas em `ARCHITECTURE.md`.
2. Ao implementar, adicionar/ajustar checklist com escopo do PR, sem alterar status do que não testou.
3. Ao fechar PR, preencher linha com data, link, testes executados, resultado e bloqueios. **Atualizar no mesmo PR** (não em documentação futura).
4. Se mudar tecnologia/fluxo, sincronizar `ARCHITECTURE.md`, `DEVELOPMENT.md` e `README.md`.
5. Nunca transformar projeções de uso/custo ou ideias discutidas em garantias ou funcionalidades entregues.

**Próxima entrega:** concluir QA Google real Firebase e PoC Drive da Fase 0; fundação Worker/D1 DEV preparada separadamente na PR #15.

### PR #7 — Ajuste da revisão e evidência DEV

- [x] Em `/review`, mostrar **ROTEIVA DEV · REVISÃO EM BREVE** no ambiente Firebase, sem identificar equivocadamente o login como demonstração; melhorar contraste do cartão escuro.
- [x] Cobertura de navegação autenticada para `/review` e retorno ao painel em desktop/mobile com Firebase Auth Emulator.
- [x] Validar [CI da PR #7 (38984055813)](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984055813): 12 testes de regras/repositório, oito Playwright desktop/mobile, builds Firebase/Pages, TypeScript e testes de domínio passaram.
- [x] Corrigir **somente a automação mobile**, que tentava preencher o campo de tarefa fora da área visível: rolagem, foco e digitação pelo teclado. A implementação da UI foi preservada. As tentativas anteriores [38983025601](https://github.com/EwertonMendes/roteiva-web/actions/runs/38983025601) e [38983735658](https://github.com/EwertonMendes/roteiva-web/actions/runs/38983735658) falharam nesse passo; não ocultar esse histórico.
- [x] PR #7 mergeada em [`c11532e`](https://github.com/EwertonMendes/roteiva-web/commit/c11532e9daf47c581eae4deea944a990fb83ecae), [CI master 38984541920](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984541920) aprovado, GitHub Pages publicado e [deploy Firebase DEV 38984744995](https://github.com/EwertonMendes/roteiva-web/actions/runs/38984744995) aprovado para o mesmo commit.
- [ ] QA real após publicação: logout/relogin, segunda conta Google, contraste de `/review` autenticado, Safari/iOS e celular físico.

**Limite:** Playwright mobile emulado e contas Auth Emulator não substituem validação com Google real nem dispositivo físico. Não apagar os registros `[QA]` existentes no Firestore sem autorização.


## Entrega Firebase DEV — PR #6

**Estado: PUBLICADO no DEV; validação automatizada concluída, QA Google real em andamento.** [PR #6](https://github.com/EwertonMendes/roteiva-web/pull/6). Auditoria e decisões em [desenvolvimento](DEVELOPMENT.md). Esta seção é a evidência específica da fundação Solo; itens Worker/Drive/PROD das fases anteriores continuam planejados.

- [x] Auditoria da master 4fbd5fd registrada antes das alterações.
- [x] Aprovação explícita da região permanente São Paulo, Standard e Spark; banco provisionado em Production Mode.
- [x] Aplicativo Web DEV registrado e somente Google habilitado; domínios Firebase e localhost confirmados.
- [x] Implementação Firebase modular, perfil privado, sessão, loading/proteção e erros.
- [x] Persistência por documento, centavos, tarefas e entregas independentes, preferência de tema, gravação pontual e revisão para conflitos.
- [x] Demo com chave original e build explícito; sem importação de dados antigos.
- [x] [CI verde no commit 3eb037a](https://github.com/EwertonMendes/roteiva-web/actions/runs/38980915291): instalação congelada, testes domínio/TS, ambos builds, 12 testes regras/repositório A/B e 8 Chromium desktop/mobile. Alterações posteriores devem repetir CI antes do merge.
- [x] Regras/índices/Hosting publicados em roteiva-web-dev: [deploy 38981719389, tentativa 2](https://github.com/EwertonMendes/roteiva-web/actions/runs/38981719389), após [CI master](https://github.com/EwertonMendes/roteiva-web/actions/runs/38981508561).
- [x] Google real em uma conta: perfil/foto, workspace inicialmente vazio, cliente/projeto/tarefa/agenda/financeiro e tema restaurados após reload.
- [ ] Concluir logout/relogin e segunda conta Google real; distinguir dos ataques A/B via SDK já testados nos emuladores.
- [ ] QA visual real desktop/mobile, claro/escuro, SPA /review e Pages.
- [x] PR #6 mergeada em [4ce6847](https://github.com/EwertonMendes/roteiva-web/commit/4ce6847eeca52adaf0fbe894d51a6bf670d911e8); release DEV e Pages concluídos.

**Testes adicionados:** `tests/firestore.rules.test.mjs` (CRUD, anônimo, A/B, UID/role/owner, timestamp, validação em updates, excesso de dados, datas/valores/referências, órfãos, atomicidade e conflito), `tests/auth-errors.test.mjs` e `tests/browser/workspace.spec.ts` (sessão e CRUD via Auth Emulator, offline, cancelamento e demo).

**Riscos/limites:** emuladores não substituem OAuth real; Safari/iOS/navegadores embutidos não estão validados; sem listener entre abas (recarregar explicitamente); sem fila offline; o recarregamento de recuperação descarta rascunhos não confirmados. Histórico activities não é auditoria inviolável. Não há promessa de custo ilimitado ou segurança exaustiva. Perfil e exclusão completa de conta continuam sem UI para evitar limpeza parcial.

**IAM autorizado e aplicado:** Firebase Rules Admin, Cloud Datastore Index Admin e Service Usage Viewer adicionados à conta de deploy existente somente no DEV. Sem Blaze ou novas chaves.


## Otimização de consultas e cache Firestore — 16/10/2026

**Objetivo:** reduzir consultas redundantes sem perder isolamento por UID, integridade de vínculos, concorrência ou compatibilidade da demonstração.

- [x] **IMPLEMENTADO (aguarda validação CI/QA):** cache persistente oficial multiaba somente por consentimento explícito nas Configurações; memória por padrão; tentativa de limpeza ao desabilitar e no logout.
- [x] **IMPLEMENTADO (aguarda validação CI/QA):** documento privado `users/{uid}/sync/state` com revisões e contagens por coleção; regras estritas para schema/propriedade; atualização transacional das revisões nas gravações do workspace.
- [x] **IMPLEMENTADO (aguarda validação CI/QA):** cache só reutilizado quando existe manifesto por UID/schema, revisão igual à remota e contagem completa; fallback para leitura do servidor, detecção de concorrência durante o bootstrap e revalidação ao retomar a aba.
- [x] **IMPLEMENTADO (aguarda validação CI/QA):** deduplicação de carregamento concorrente e testes unitários e de segurança para a sincronização.
- [x] **IMPLEMENTADO (aguarda CI/QA do novo HEAD):** carregamento inicial por rota, Visão Geral com projetos recentes limitados e agregações, listas de Projetos e Clientes com cursor e busca textual completa sob demanda, exportação integral e isolamento entre domínios completos/parciais.
- [x] **IMPLEMENTADO (aguarda CI/QA do novo HEAD):** Projetos e Clientes usam Carregar mais e cursores estáveis; Projetos filtra status na origem e associa tarefas, Clientes mantém contagem total/recorrentes agregada e vínculo com projetos, e o Dashboard usa agregações de valores a receber e etapas, com caminho econômico para até quatro projetos.
- [x] **IMPLEMENTADO (aguarda validação CI/QA):** Financeiro por mês selecionado e gráfico anual por agregações (reuso de leitura completa em contas pequenas e atualização dos meses afetados). Agenda por três meses exibidos e quatro próximos compromissos, com contagens gerais via documento de sincronização. Preserva totais do mês, vínculos, filtros, CSV e exportação JSON completa.
- [ ] **MELHORIA FUTURA DEPENDENTE DE ESCALA:** cursor de até 24 lançamentos **dentro** de meses com centenas de movimentos, exigindo agregações materializadas verificáveis para preservar donut, parcelas, filtros e CSV exatos. A otimização atual é por mês, não por página de lançamento.
- [x] **IMPLEMENTADO (aguarda CI/QA do novo HEAD):** UI Firebase não persiste efeitos de renderização; ações chamam comandos tipados por documento para projetos, tarefas, entregas, clientes, finanças, agenda e atividade, com controle de revisão e contadores transacionais. Demo preserva o localStorage original. O salvamento de workspace integral continua somente para compatibilidade e testes.
- [x] **IMPLEMENTADO (diagnóstico, não faturamento):** métricas locais de leituras/escritas na sessão, mostradas em Configurações, com cenários de comparação e agregações nos testes do emulador.
- [ ] **PENDENTE DE DADOS DO CONSOLE:** comparar leituras/escritas efetivamente faturáveis no Firebase DEV antes/depois, incluindo Rules, índices e retries. O SDK/emulador não consegue recuperar essa medição sozinho.
- [ ] **VALIDAÇÃO PENDENTE:** CI da PR, QA duas contas reais, F5 com cache consentido, exclusões, concorrência, IndexedDB em mobile e impacto real nas quotas.

**Decisão de segurança:** não persistir dados em disco sem consentimento explícito do usuário; o SDK do Firebase não oferece limpeza criptográfica segura de cache do navegador. Dados privados em dispositivo compartilhado exigem cache desativado. Nenhum recurso novo foi provisionado e a demonstração permanece local.

- [x] **PR #14 — recuperação de leituras (aguarda CI/deploy):** erros de consulta transitórios são retomados automaticamente; falhas por índices ainda não disponíveis têm fallback completo e verificado; a tela de recarregamento manual deixa de ser usada para leituras. Gravações incertas preservam o aviso explícito, sem repetição cega.

## Fundação Google Drive + Cloudflare DEV — PR #15 (17/10/2026)

**Estado geral: PARCIAL.** Infraestrutura e contratos mínimos não representam a biblioteca concluída.

- [x] **VALIDADO:** auditoria da master b4e86d7, AGENTS/README/arquitetura/roadmap/desenvolvimento, workflows e regras; nenhum Worker/D1 existente na conta.
- [x] **IMPLEMENTADO:** pacote API isolado; identidade Firebase RS256/JWKS, CORS de origem exata, erros sem conteúdo privado, AES-GCM com versão/AAD, migração e repositório por UID.
- [x] **IMPLEMENTADO:** start/callback com state de uso único, PKCE, nonce OIDC e cookie; renovação, invalid_grant, revogação e consulta mínima de metadados. OAuth desabilitado por padrão.
- [x] **VALIDADO em infraestrutura remota:** criação do Worker roteiva-api-dev, endereço workers.dev e D1 roteiva-drive-dev com binding DB. Publicação inicial do scaffold não prova os endpoints da API.
- [x] **VALIDADO no Console:** projeto Google roteiva-drive-dev, Drive API e Picker API ativados; identidade Roteiva Drive DEV e cliente web com callback real; tela externa Testing, proprietário como usuário de teste, escopos openid/e-mail/drive.file salvos. Aceites Picker/política de dados e criação das credenciais autorizados pelo proprietário nesta conversa.
- [x] **VALIDADO:** Client Secret e chave AES armazenados como Worker Secrets; token Cloudflare salvo no environment GitHub cloudflare-development, sem expor valores em código/chat.
- [x] **VALIDADO no CI 39055131858:** auditoria sem vulnerabilidades conhecidas após atualização das ferramentas, seis testes iniciais, typecheck, migração D1 local e build dry-run. Isso **não** prova OAuth real ou banco remoto.
- [x] **VALIDADO:** [publicação DEV 39055895154](https://github.com/EwertonMendes/roteiva-web/actions/runs/39055895154), commit 0d8d7bc: oito testes de API, npm ci/audit, typecheck, migrations local/remota, deploy e smoke HTTPS (health 200 + token inválido 401). Conferência health também no Chrome. A primeira tentativa aplicou a migration mas recusou cpu_ms no Free; corrigido sem upgrade. Último HEAD documental/workflow passa pelo CI separado.
- [ ] **PLANEJADO:** PoC com consentimento Google real, renovação real, metadado de arquivo selecionado e duas contas reais; UI/biblioteca/uploads continuam fora deste PR.
- [ ] **PARCIAL — PR posterior à #15:** fluxo de lançamento de uso único em primeira parte implementado, com migração D1 aditiva, cookie SameSite=Lax e teste automatizado. QA real Chrome/Safari/mobile ainda pendente; domínio próprio opcional, recuperação/rotação de chaves e retenção/reconciliação continuam planejados.
- [ ] **PLANEJADO:** políticas públicas, domínio verificado, escopos/branding finais e análise de publicação OAuth. Não publicar app nem ampliar escopos automaticamente.

**Testes simulados:** Google token endpoint usa mocks; identidade Firebase usa JWTs RS256 assinados em teste e JWKS local; AES-GCM usa criptografia real com dados sintéticos; schema usa SQLite real e Wrangler/D1 local. Nenhum teste simulado comprova consentimento Google, renovação real, Picker, arquivos reais ou isolamento de duas contas reais. A suíte verifica assinatura/issuer/audience/expiry, AAD, ciphertext adulterado, consulta por owner, replay SQL, CORS e invalid_grant.

- **Segurança operacional:** encerrado o bootstrap; environment cloudflare-development restrito à master e workflow normal condicionado ao CI frontend. Publicação automática pós-merge ainda deve ser observada; não confundir bootstrap real com execução futura na master.


## PoC de conexão Google Drive DEV — PR #17 (17/10/2026)

**Estado: IMPLEMENTADO (QA real pendente).** A Biblioteca DEV exibe painel de conexões reais autenticadas via Firebase. Iniciar autorização chama Worker, navega para a rota top-level com cookie de primeira parte e retorna a `/biblioteca`. Lista conexões do proprietário, consulta `about.get` do Google Drive por refresh no backend para provar autorização e permite revogação explícita.

- [x] **IMPLEMENTADO:** painel Firebase DEV sem alteração visual ou dados da demonstração Pages.
- [x] **IMPLEMENTADO:** endpoint de consulta mínima `/integrations/drive/:connectionId/about` por usuário, sem devolver credenciais.
- [x] **IMPLEMENTADO:** `OAUTH_ENABLED=true` somente no Cloudflare DEV para o teste com contas autorizadas no Google Testing.
- [x] **IMPLEMENTADO:** teste mock para refresh e resposta limitada da consulta de conta.
- [ ] **PENDENTE:** deploy da PR após CI verde e merge, seguida de consentimento Google real, validação de cookie Chrome/Safari/mobile, Drive API real, expiração/reconexão e duas contas.
- [ ] **PENDENTE:** Google Picker e chave pública restrita; seleção de arquivos, múltiplas pastas, mídia, uploads e aprovações.
- [ ] **PENDENTE:** migração OAuth para In production após requisitos legais e de verificação; em Testing, tokens offline geralmente expiram em sete dias.

Se houver falha em teste de segurança/cookie, desabilitar imediatamente OAuth via configuração e deploy, sem substituir por access token no localStorage. Não tratar mock ou build como evidência de acesso real.

## Correção do callback OAuth — teste inicial (17/10/2026)

- [x] **DIAGNÓSTICO:** navegador chegou ao callback Google real, mas a implementação antiga devolveu `offline_consent_required` genérico; o teste não comprovou concessão do refresh token nem acesso à API.
- [x] **IMPLEMENTADO — aguarda CI:** validação separada de identidade, permissão Drive e refresh offline; `scope` omitido usa prova real `Drive about.get` em vez de presumir falha. Se o refresh não vier em novo vínculo, não salvar conexão sem renovação; vínculo existente somente reutiliza credencial cifrada da mesma conta.
- [x] **IMPLEMENTADO — aguarda CI:** retorno do callback à Biblioteca com códigos estáticos de recuperação, sem página JSON/segredos.
- [ ] **VALIDAÇÃO REAL PENDENTE:** repetir consentimento com a conta testadora no Chrome, confirmar `?drive=connected`, testar `Drive about.get` e reconectar após nova sessão. Tests mocks/CI e health não demonstram isso.

## Biblioteca Drive com pastas por projeto — implementação em DEV (17/10/2026)

- [x] **IMPLEMENTADO (aguarda CI):** uma única autorização inicial para `drive.file` e `drive.readonly`, mantendo refresh tokens no Worker/D1; contas legadas estreitas precisam apenas de consentimento de atualização via botão Vincular pastas.
- [x] **IMPLEMENTADO (aguarda CI):** pós-OAuth restaura projeto selecionado e abre automaticamente navegador de pastas; múltiplos vínculos por projeto e paginação.
- [x] **IMPLEMENTADO (aguarda CI):** navegação de pastas e subpastas, leitura de metadados de mídia pelo Worker, preview Google com fallback e Firestore Rules restringindo vínculos ao UID/projetos próprios.
- [ ] **QA real pendente:** consentimento Google ampliado, duas contas e 403/404, arquivos reais, Safari/mobile e limitação das prévias embutidas.
- [ ] **PLANEJADO:** upload direto Drive, comentários/labels/versões, compartilhamento seguro ao cliente e fluxo de revisão assíncrona.
- [ ] **REQUISITO para público:** escopo restrito `drive.readonly` exige cumprir política e revisão de segurança Google antes de habilitar para usuários externos.

Não confundir biblioteca navegável MVP com aprovação/produção audiovisual completa.

## Refinamento de interface — iconografia semântica (17/10/2026)

- **IMPLEMENTADO; validação CI/QA pendente nesta PR:** mapear filtros e badges de status dos projetos com o mesmo ícone Lucide e texto, mantendo os filtros funcionais via teclado e `aria-pressed`.
- **IMPLEMENTADO; validação CI/QA pendente nesta PR:** ícones contextuais nos indicadores/links de clientes, quatro métricas e filtros financeiros, cabeçalhos de gráficos/alerta, e campos selecionados de Configurações.
- **IMPLEMENTADO; validação CI/QA pendente nesta PR:** componente acessível `IconLabel`, CSS adaptativo claro/escuro/mobile e regressão `tests/browser/semantic-icons.spec.ts`.
- **Sem alterações:** dados Firestore, autenticação, Worker/Drive, cálculos e exportações, navegação e laboratório temporário de fontes.
- **Aceite:** `pnpm typecheck`, `pnpm test`, builds Firebase/Pages/Emulator, testes Playwright desktop/mobile e validação visual final pelo proprietário no DEV; a auditoria visual humana pode exigir ajustes finos posteriores.

Evidências: `src/features/ui/`, `src/dashboard-client.tsx`, `src/studio-features.tsx`, `src/features/settings/SettingsPage.tsx`, `tests/browser/semantic-icons.spec.ts` e a PR desta implementação.

## Refinamento UI — simplificação da barra lateral (outubro/2026)

- **IMPLEMENTADO; revisão visual final pendente:** remover o cartão informativo de estúdio/arquivos/sincronização da sidebar, mantendo logo, navegação e perfil com saída no rodapé, em mobile e desktop.
- Evidências: `src/dashboard-client.tsx`, regras residuais removidas em `src/globals.css`, `src/responsive.css`, `src/refined-theme.css`, regressão em `tests/browser/typography.spec.ts`. Validação de CI e publicação pela PR correspondente.
- Sem mudanças em Firestore, banco, Worker, credenciais, autenticação, navegação, arquivo no Drive ou decisões de arquitetura.

## Cache e renovação coordenada de tokens Drive — 17/10/2026

**Estado: IMPLEMENTADO e publicado no DEV pela PR #25 (sem merge automático).** Sem mudança de escopos, frontend, regras Firestore, arquivos do Drive ou infraestrutura paga.

- [x] Cache D1 cifrado com expiração Google/margem 60s, isolamento por proprietário/conta/revisão e migration aditiva 0003.
- [x] Lease SQL de 20s, polling limitado 8s, fencing de resposta atrasada e cooldown transitório; rotação de refresh/cache atômica.
- [x] Invalidação em consentimento/desconexão/revogação; invalid_grant antigo não invalida nova conexão.
- [x] Cliente único de GETs Drive; um retry em 401, sem renovar por 403/cota; eventos categóricos sem credenciais.
- [x] Testes com SQL/AES reais e Google simulado para expiração, concorrência e falhas.
- [x] CI frontend e 36 testes API; migration remota 0003 e publicação DEV. Evidência em DEVELOPMENT.md.
- [ ] QA do proprietário com conexão real, leitura repetida de pastas, expiração real e comparação de métricas. Nenhuma redução percentual/latência real presumida.


## Biblioteca 2.0 — explorador de projetos (PR #29, outubro/2026)

**Estado: IMPLEMENTADO na PR #29 e VALIDADO no CI; deploy DEV e QA com conta Google real ainda pendentes.** A PR trata UX da listagem/vinculação existente, não conclui a Fase 4 (uploads, versões, permissões de revisão e busca global continuam planejados).

- [x] Explorer desktop em duas colunas; no mobile, navegação em um nível e retorno explícito.
- [x] Vínculo múltiplo em uma única confirmação com seleção persistida ao navegar; vínculos existentes sinalizados, sem exclusão da mídia.
- [x] Seletor com Meu Drive/Todas as pastas, histórico de navegação, rolagem contida, Escape/foco e filtro local de itens carregados.
- [x] Conta Google recolhida no topo; confirmação de desvinculação; prévia/abrir no Google Drive e tratamento de erro.
- [x] Contador de pastas baseado em `driveFolders` no modo Firebase (a demo conserva seus próprios registros); remover busca global enganosa de arquivos.
- [x] Ignorar respostas obsoletas de consultas ao navegar/trocar projeto e reutilizar os contratos atuais sem migrar Firestore/D1.
- [x] Testes Playwright adicionados em `tests/browser/drive-folders.spec.ts` (seleção múltipla, F5, recuperação e mobile): 40 testes Playwright aprovados e 2 ignorados por projeto (desktop/mobile); [run 39092230199](https://github.com/EwertonMendes/roteiva-web/actions/runs/39092230199).
- [x] CI TypeScript, lógica de domínio, builds Firebase/Pages, emuladores e Playwright aprovados: [frontend run 39092230199](https://github.com/EwertonMendes/roteiva-web/actions/runs/39092230199) e [API run 39092230110](https://github.com/EwertonMendes/roteiva-web/actions/runs/39092230110).
- [ ] Validar visual real no DEV: mobile/desktop, dark/light, várias pastas e paginação, pastas compartilhadas, acessibilidade e erros/reconexão OAuth.

Critérios de aceite: fluxo sem rolagem modal+fundo, sem mudança na propriedade dos arquivos, filtragem explícita somente dos itens carregados, navegação sem sobrescrita de resultados anteriores, nenhuma regressão do OAuth. Evidência: [PR #29](https://github.com/EwertonMendes/roteiva-web/pull/29), `src/features/drive/DriveConnectionPanel.tsx`, `DriveLibraryUI.tsx`, `drive-library.css`, `tests/browser/drive-folders.spec.ts`.
