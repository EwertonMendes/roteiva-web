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

**Status: implementado na PR #55 e publicado no DEV existente; fluxos centrais homologados com Google real, aceite integral parcial por limitações documentadas.** Publicação antecipada autorizada pelo proprietário em 20/10/2026; não houve merge. Migrações 0013/0014 aplicadas com integridade e contagens preservadas; Worker/Hosting publicados, CI completo aprovado. Consulte [REVIEWS-MVP.md](REVIEWS-MVP.md).

- [x] Central de aprovações com pesquisa por cliente/projeto/título, estados e paginação; atalhos de cliente/projeto.
- [x] Seleção de até 8 arquivos existentes do Google Drive, com validação server-side de projeto, pasta e descendência.
- [x] Links revogáveis e expiráveis com dois modos: link aberto e Google autorizado.
- [x] Portal mobile: prévia/fallback, comentários, timestamp manual, aprovação e solicitação de ajustes.
- [x] História por versão, reenvio após ajustes, decisões únicas e exclusão/expiração com revogação coordenada.
- [x] Isolamento por proprietário no backend, Hash/AES-GCM de convites e sem exposição pública do Firestore.
- [x] Publicação e revogação de ACL com duas identidades Google reais; conta incorreta recusada, destinatária autorizada e permissão removida pelo cron.
- [x] Testes automatizados locais: 129 API, 37 frontend, 30 regras e 81 E2E aprovados (3 variantes de viewport ignoradas por desenho); Google real/Safari/aparelho físico e pipelines do SHA final são aceites separados.
- [x] Auditoria adicional da PR #55: claims/leases de ACL, compensação recuperável, fence de versão pública e transição D1; testes em `api/tests/reviews.test.mjs`. Ciclo completo desktop/mobile em `tests/browser/reviews-workflow.spec.ts`, incluindo upload resumable e encerramento; homologação Google real agora confirma link, duas identidades, comentário/ajustes/V2/aprovação, ACL prévia, revogação, cron, desconexão e exclusão DEV concluída; limitações de Picker/dispositivos em [REVIEWS-MVP.md](REVIEWS-MVP.md).
- [x] Deploy no DEV existente e homologação com fixtures/contas descartáveis autorizadas; exclusão de conta concluída com arquivos Drive preservados.
- [ ] Resolver/retestar Google Picker para autorizar nova pasta e completar aceite em dispositivos/políticas externas aplicáveis antes do piloto comercial.

**Fora do MVP:** player próprio com timeline, streaming pelo Worker, edição de imagens, assinatura legal, notificações automáticas e aprovação parcial por arquivo.

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

## Prévia visual da Biblioteca (PR #29)

**IMPLEMENTADO na branch de PR; teste manual pendente.** Para evitar confundir a versão antiga publicada no DEV com a nova Biblioteca ainda não mergeada, a PR tem dois previews:

- `pr-29-design`: build demo temporário com a mesma UI de produção e registros sintéticos, sem login nem Google Drive. Testa o desenho móvel/desktop, navegação hierárquica e vínculo múltiplo em memória; não confirma integração ou persistência.
- `pr-29`: build Firebase real, que permanece bloqueado para testes autenticados até o domínio de preview ser autorizado no Firebase Authentication e a origem exata autorizada na API DEV; não ampliar CORS genericamente nem liberar credenciais em PRs não confiáveis.

A URL do DEV principal não mudou e o merge não foi executado. CI para preview deve permanecer limitado à PR interna #29 e usando exclusivamente o site Firebase DEV, com validade de sete dias. A validação de login/Drive real continua pendente.

### Exclusão permanente de conta — PR #30 (DEV, 18/10/2026)

- [x] Fluxo de confirmação no React e reautenticação recente em Configurações. Por decisão do proprietário em 18/10, retirar a ação da tela de primeiro acesso para manter foco no cadastro; backend tolera ausência de perfil.
- [x] Executor idempotente Worker/D1 em etapas com lease e cron, revogação Google Drive, limpeza recursiva de subcoleções Firestore e Auth no encerramento.
- [x] Bloqueios de gravação nas regras Firestore e de novas conexões OAuth no D1.
- [x] Testes de erro, paginação, UID isolado e fluxo de exclusão simulado.
- [x] CI do HEAD atualizado: [API/57 testes](https://github.com/EwertonMendes/roteiva-web/actions/runs/39138799295), [frontend/28 Rules/42 browser](https://github.com/EwertonMendes/roteiva-web/actions/runs/39138799304). QA visual real desktop escuro/mobile claro (390×844), confirmação rigorosa e cancelamento conferidos.
- [x] Fluxo Google real no DEV: conta de teste especificamente autorizada, reautenticação, Cron retomou falha Firestore e concluiu; 23 caminhos/identidade ausentes, controle intacto, Drive original preservado e concessão revogada.
- [x] Provisionamento administrativo DEV (18/10/2026): conta exclusiva, papel customizado com seis permissões, segredo Worker via stdin, smoke real com duas identidades novas/71 documentos; isolamento e exclusão Auth idempotente confirmados. Sem validação Google/Drive pela interface neste smoke. Detalhes e limitações em [ACCOUNT-DELETION.md](ACCOUNT-DELETION.md).
- [x] Revisão: fence contra recriação por JWT residual, 404 de enumeração falha fechado, limites de execução/lease, `failed_phase` e guards OAuth duráveis; testes locais de 1.001 documentos, pai ausente e revisão manual. Rules Emulator e Playwright: 42 aprovados, dois skips previstos. CI da PR #30 aprovado; correções de runtime/UX na PR #31, com evidências CI em ACCOUNT-DELETION.md.
- [x] Runbook de retomada individual e monitor DEV implementados; [monitor executado](https://github.com/EwertonMendes/roteiva-web/actions/runs/39139569153), sem pendências nesse instante. Merge PR #30 e deploys oficiais [Worker/D1](https://github.com/EwertonMendes/roteiva-web/actions/runs/39139423106)/[Firebase](https://github.com/EwertonMendes/roteiva-web/actions/runs/39139422996) aprovados; migrações `0004`–`0006` e Cron remoto conferidos.
- [ ] Confirmar entrega de alertas de Actions aos responsáveis em falha; a execução saudável do monitor não comprova notificação entregue.

O DEV publicado tem `ACCOUNT_DELETION_ENABLED=true` e credencial administrativa validada; sem a credencial exata, o endpoint falha fechado. O teste destrutivo completo foi verificado. A PR #31 corrige acompanhamento, orçamento e linguagem; sua publicação é feita pelo pipeline oficial da master após CI aprovado. O caso sem cadastro não possui mais entrada destrutiva na UI por decisão do proprietário. A correção inclui linguagem comercial nas telas, polling sem falso sucesso e lotes compatíveis com o limite Workers Free. Evidências em [ACCOUNT-DELETION.md](ACCOUNT-DELETION.md).

### Exclusão sem confirmação Google redundante (18/10/2026)

**IMPLEMENTADO, CI/publicação rastreados na PR:** aproveitar login recente sem popup extra. O Worker mantém `auth_time <= 300s`; sessão antiga requer confirmação explícita com Google. Modal mostra e-mail, provedor recebe login_hint e seleção de conta diferente deve interromper a submissão sem trocar a conta Roteiva. Testes API e browser incluem login recente/antigo, cancelamento e conta incorreta. Sem mudança em IAM, credenciais, Firestore Rules, CORS ou dados de contas reais. Ver [ACCOUNT-DELETION.md](ACCOUNT-DELETION.md).

### Cache de HTML em rotas do Firebase Hosting (18/10/2026)

- [x] Identificada causa: `/index.html` estava com `no-cache`, mas os deep links SPA (por exemplo `/configuracoes`) não correspondiam ao header e podiam guardar HTML antigo por uma hora.
- [x] IMPLEMENTADO em PR: cabeçalho `no-cache, no-store, must-revalidate` para todas as rotas antes do rewrite, sobreposto por `max-age=31536000, immutable` em `/assets/**` (assets hashed).
- [x] IMPLEMENTADO em PR: teste do contrato e verificação pós-deploy dos headers HTTP reais no workflow Firebase DEV.
- [ ] VALIDAR após merge: CI verde, deploy DEV confirmado e headers reais corretos para `/`, `/configuracoes`, `/biblioteca`, `/index.html`, deep link e asset hashed. Se a verificação pós-deploy falhar, investigar sem ignorar o resultado.

A correção não altera o fluxo seguro de exclusão da PR #32 nem os dados Firestore/D1; não atualiza automaticamente uma aba já aberta antes do deploy.

### Ajustes de Configurações — Zona de perigo / cache automático (18/10/2026)

- [x] IMPLEMENTADO em PR: remover `04 / CONTROLE` e `Dados e privacidade`, incluindo botões de exportar dados e ativar/desativar cache.
- [x] IMPLEMENTADO em PR: `Zona de perigo` separada visualmente com destaque vermelho para `Excluir conta`, preservando o modal seguro e o processo de exclusão existente.
- [x] IMPLEMENTADO em PR: armazenamento persistente automático com revalidação via revisão/contagem por UID no servidor; navegador sem persistência usa cache volátil ou leitura normal.
- [x] IMPLEMENTADO em PR: limpeza de manifestos antes da tentativa de apagar IndexedDB após logout.
- [ ] VALIDAR: CI e testes Playwright desktop/mobile (interface, reload, isolamento de usuário e logout), Firebase Rules e ausência de controles antigos.
- [ ] VALIDAR: visual DEV após merge, sem excluir contas reais durante homologação desta PR.

A cópia persistida é privada e potencialmente sensível em computadores compartilhados: orientação de privacidade precisa refletir que o logout apaga a cópia quando tecnicamente possível. A revisão remota permanece necessária para evitar apresentar dados desatualizados.

## Infraestrutura — pipeline rápida DEV (2026-10-18)

- **IMPLEMENTADO NO CÓDIGO; VALIDAR NA PR:** separar validação e deploy do frontend Firebase, API Cloudflare/D1 e regras Firestore; retirar GitHub Pages e a dependência `workflow_run`. Evidência: `.github/workflows/frontend.yml`, `api.yml`, `firebase-infra.yml`.
- **IMPLEMENTADO NO CÓDIGO; VALIDAR NA PR:** mover regressão completa desktop/mobile para workflow noturno/manual sem bloquear UI. Evidência: `.github/workflows/qa-regression.yml`, `playwright.config.ts`.
- **IMPLEMENTADO NO CÓDIGO; VALIDAR NA PR:** preview manual e isolado de qualquer PR interna pela master, canal expirando em 7 dias; verificar autenticação/CORS antes de aceitar teste Drive real. Evidência: `.github/workflows/preview.yml`.
- **PARCIAL/BLOQUEADO POR SEGURANÇA:** operações Firebase somente em repositório privado com conta de serviço separada; contagem/leitura e fixtures; dados de negócio sem mutações administrativas genéricas. Evidência: `.github/workflows/firebase-ops.yml`, `scripts/firebase-ops.mjs`, `tests/firebase-ops.test.mjs`.
- **PLANEJADO:** provisionar PROD com Firebase, Worker, D1, segredos e OAuth próprios após aprovação. Exemplos de configuração foram adicionados; nenhum deploy PROD está habilitado.
- **PENDENTE:** verificar a duração real das pipelines após abrir e mesclar PR. A meta de até 60 segundos vale para deploys comuns, não Playwright/infra pesada ou indisponibilidade externa.


## Biblioteca — miniaturas e visualização aprimorada (18/10/2026)

- **IMPLEMENTADO NO CÓDIGO, VALIDAR NO DEV:** lista/grade persistida como preferência visual, miniaturas imagens/vídeos/PDF quando `thumbnailLink` disponível, carregamento sob demanda, limite de requisições e fallback de ícones. Evidência: `DriveThumbnail.tsx`, `DriveLibraryUI.tsx` e CSS.
- **IMPLEMENTADO NO CÓDIGO, VALIDAR NO DEV:** proxy de miniaturas privadas: identidade Firebase, conexão do usuário, escopo, URL Google permitida, tipo de imagem, tamanho máximo e sem original `alt=media`. Evidência: `api/src/thumbnails.ts`, `api/tests/thumbnails.test.mjs`.
- **PENDENTE QA REAL:** vídeos e PDFs de conta Google conectada, permissões não compartilhadas, iframe em navegadores mobile e cópia de URL externa. Não confundir suíte de testes unitários com confirmação manual Google OAuth.

## Controle de acesso SaaS — rollout DEV (19/10/2026)

- **VALIDADO REMOTAMENTE:** PRs #43–#46 publicaram migrations aditivas 0007/0008, Worker com provisionamento único e regras preparatórias de leitura de status. Contagens operacionais preservadas e zero violações FK no pipeline. A credencial instalada criou as três projeções, sem alteração IAM.
- **DECISÃO CONFIRMADA PELO PROPRIETÁRIO:** manter, por enquanto, cortesia de 30 dias para contas existentes no marco fixo da migração (sem extensão automática para três meses), separada do trial imutável de sete dias; repetição não renova benefícios.
- **VALIDADO REMOTAMENTE:** três perfis existentes, três cortesias com duração exata e três projeções válidas; backfill concluído e contagens de negócio iguais. Conta existente confirmou a cortesia e listagem de quatro arquivos Drive sem reconexão ou alteração de arquivos.
- **PUBLICADO:** frontend integrado da PR #47 pelo run 39356744391. AccessGate aguarda provisionamento e snapshot do servidor; cadastro informa sete dias e estados bloqueados mantêm reverificação, saída e exclusão.
- **CORRIGIDO E VALIDADO:** redirect error introduzido na fase 2 causava TypeError no runtime Workers e impedia provisionamento/Drive. PR #46 usa manual, reproduzido em workerd e confirmado pela recuperação real. Não houve mudança de credencial.
- **VALIDADO AUTOMATICAMENTE:** 82 testes API, 27 unitários frontend, 30 Rules e 55 Playwright desktop/mobile; três skips previstos. TypeScript, builds e migrations locais até 0009 aprovados. CI não comprova os cenários remotos pendentes.
- **PUBLICADO — PR #48, merge b0ae124, API 39358435356 e regras 39358435474:** regras comerciais finais e ACCESS_PROVISION_ON_DRIVE=false; sync_pending da migration 0009 impede republicação concorrente durante futuras alterações privilegiadas. Nenhuma interface ou rota ADM. Protocolo obrigatório e testes em ACCESS-CONTROL.md e access-provisioning.test.mjs.
- **PARCIAL NA HOMOLOGAÇÃO REAL:** expiração e isolamento A/B remotos permanecem pendentes; a exclusão e o recadastro descartáveis foram posteriormente validados na PR #51. Cadastro e segundo login Google já foram confirmados: trial exato de sete dias, sem concessão beta; recarga e login não alteraram prazo/updateTime da projeção. Enforcement publicado. Suspensão e reativação por cortesia confirmadas, com trial/projeto preservados e fence liberada; pedido de exclusão descartável aceito após autenticação recente manual, com conclusão da saga e recadastro posteriormente confirmados na PR #51. Expiração/isolamento A/B remotos não concluídos.
- **MEDIDO:** billing Firebase desabilitado; Monitoring em 20/10/2026 02:11 UTC indicou 209 leituras e seis escritas nas 24h anteriores. Métricas Cloudflare anteriores ao rollout registradas no runbook; repetir medição após regras finais, sem garantir consumo futuro.

Evidências de deploy, commits, limites da comparação por contagens e reversão segura: [ACCESS-CONTROL.md](ACCESS-CONTROL.md). A PR #42 foi encerrada como substituída pelas entregas #43–#48; sua branch foi preservada.



- **VALIDADO NO PIPELINE OFICIAL DA MASTER:** [QA 39358964120](https://github.com/EwertonMendes/roteiva-web/actions/runs/39358964120), commit b0ae124: 30 Rules + 55 Playwright aprovados, três skips previstos. Pedido real de exclusão descartável aceito após login manual recente; conclusão da saga e proteção no recadastro posteriormente verificadas na PR #51.

## Upload resumable para pastas vinculadas — PR #52 (20/10/2026)

**Status: PUBLICADO no DEV; Picker e upload >250 MiB reais validados no Chrome; aceite completo PARCIAL. PR #52 mergeada por autorização expressa.**

- [x] Auditoria da implementação existente e dos checks; master com PRs #51/#53/#54 incorporada.
- [x] JWT/Origin/entitlement/UID, vínculo e existência do projeto, ascendência real,
  capacidade da pasta destino e autorização por app verificadas no backend.
- [x] Migration 0012: tentativa por UID, file ID pré-gerado Google, capacidade cifrada,
  confirmação vinculada e idempotente, TTL/limpeza e fence de reconexão.
- [x] Google Picker oficial implementado via novo GIS token drive.file + openid,
  include_granted_scopes=false, validação servidor de cliente/subject/escopos/validade.
- [x] Fila permanece ao navegar no workspace, duas transferências, limite de 100,
  progresso confirmado, probes após falhas, retomada explícita na mesma
  sessão/página e cancelamento.
- [x] Confirmação incerta pode repetir só a verificação, sem retransmitir arquivo;
  invalidação seletiva e thumbnails privadas quando disponíveis.
- [x] Testes API/SQLite/JWT sintético, cliente e E2E com provedores simulados ampliados.
  Evidência final de checks na própria PR; não equivalem a homologação Google real.
- [x] Script opt-in de prova real reproduzível: scripts/qa-drive-real.mjs, sem tokens em logs.
- [x] Chave Roteiva Picker DEV criada, restrita à origem DEV, iframe oficial docs.google.com e somente Picker API;
  secret GOOGLE_PICKER_API_KEY configurado no Worker DEV e inventário conferido.
- [x] Conexão com acesso ativo identificada por consulta de estado D1, sem mudar trial/grant.
- [x] Homologação temporária de branch no DEV autorizada pelo proprietário, sem merge:
  migration0012 com integridade/contagens preservadas, Worker e Hosting publicados;
  release anterior preservada para reversão. Prévia oficial Firebase também passou.
- [x] Login normal concluído pelo proprietário; pasta QA vazia vinculada pelo produto;
  GIS/Picker reais e autorização exata conferida pelo Worker.
- [x] Upload real UI Chrome de 276.509.032 bytes direto ao Google, arquivo no parent
  correto por leitura independente; uma tentativa D1 completed e capability apagada.
  Worker remoto respondeu 204/401/403 conforme contrato. Sem trace HTTP individual.
- [ ] Recuperação com interrupção real: proprietário preferiu deixar manual/pendente.
  Cobertura de falhas/retomada isolada não substitui esse aceite.
- [ ] QA Google A/B, revogação/reconexão, Safari e dispositivo móvel físico.
- [x] Merge expressamente autorizado pelo proprietário, commit `9652d98`;
  [API](https://github.com/EwertonMendes/roteiva-web/actions/runs/39477057568) e
  [Hosting](https://github.com/EwertonMendes/roteiva-web/actions/runs/39477057527)
  publicados pelos workflows oficiais, com validações e smoke aprovados.

F5/fechamento perde seleção e fila; beforeunload alerta. Nenhuma retomada entre
sessões é prometida. Publicação DEV oficial após merge autorizado; PROD preservado.
Configuração, limites, decisões e procedimento completo: [DRIVE-UPLOAD.md](DRIVE-UPLOAD.md).

### QA de acesso SaaS isolado — PR #50, integração de 20/10/2026

**IMPLEMENTADO e VALIDADO localmente (6/6 cenários) com master/PR #52.** Seis cenários adicionais
desktop/mobile exercitam expiração, isolamento A/B e exclusão com provedores
simulados em `demo-roteiva`, mais Rules e Worker/D1 isolados. Expectativa antiga de
exclusão no acesso expirado foi corrigida para respeitar a PR #54; não se reintroduziu
a ação na UI. Workflow sem secrets/deploy cobre também alterações de Auth/Access,
antifraude e confirmação de exclusão. Resultados finais vinculados na PR #50.
Limites, comandos e distinção de QA remoto em [QA-ACCESS-ISOLATED.md](QA-ACCESS-ISOLATED.md).



### Proteção de reutilização do trial — PR #51, auditoria de 20/10/2026

**PUBLICADO e VALIDADO no DEV para o exploit de exclusão/recadastro.** Auditoria encontrou gravações parciais de HMAC, associação indevida de aliases recusados, ausência de proteção contra troca da chave e corrida entre publicação da projeção e exclusão. Corrigidos com D1 batch, HMAC do UID, propagação do titular conflitante, verificador persistente e commit Firestore atômico condicionado ao perfil. Migration 0011 aditiva preserva 0010 e dados existentes. Saga anterior sem marcador pausa antes de remover dados.

- [x] Testes focados API/SQLite e integração binding D1 no workerd isolado; [QA completo oficial](https://github.com/EwertonMendes/roteiva-web/actions/runs/39458594416) aprovado no commit publicado: 30 Rules, 55 Playwright (três skips previstos) e saga integrada adicional. Nenhuma conta real excluída.
- [x] Mensagem de cadastro condiciona sete dias à elegibilidade única; estado expirado explica exclusão/recadastro.
- [x] Retenção técnica e runbook de recuperação/rotação documentados; nenhuma declaração de conformidade jurídica.
- [x] CI do SHA final, secret DEV, inventário D1 e merge `6c5c377f5b0cbf4ccecd0902382210ef56c7d8ad` na [PR #51](https://github.com/EwertonMendes/roteiva-web/pull/51); migrations 0010/0011 e Worker pelo [pipeline oficial API](https://github.com/EwertonMendes/roteiva-web/actions/runs/39457463449), Hosting pelo [pipeline frontend](https://github.com/EwertonMendes/roteiva-web/actions/runs/39457463444), todos aprovados.
- [x] Google descartável autorizado no Worker/Hosting publicado: primeiro cadastro com sete dias, F5/datas idênticas, logout/login real sem renovação, saga concluída preservando marcadores, recadastro com novo UID e trial recusado. Contas comerciais existentes preservadas; detalhes e limites no runbook.
- [ ] Homologação remota com segunda identidade Google descartável distinta e nova concessão Drive real: não executadas nesta rodada; controles e falhas cobertos em isolamento.
- [ ] Atualização dos advisories preexistentes nas dependências frontend/CLI: sete reportados, três altos, fora da correção antifraude.

Evidência e distinção entre unitário, D1 isolado, browser/emuladores e DEV em [TRIAL-REUSE-PREVENTION.md](TRIAL-REUSE-PREVENTION.md).


### Exclusão de conta restrita às Configurações — 20/10/2026

**Decisão confirmada pelo proprietário; IMPLEMENTADO nesta alteração.** Retirar a exclusão de acesso expirado, suspensão e falha de validação; manter apenas a Zona de perigo de Configurações para acesso ativo. Novos pedidos no Worker usam os direitos D1 reais; preservar jobs já aceitos e status/cron. Nenhuma mudança de dados, grants, migrations ou segredo antifraude.

Evidências: api/tests/deletion-access.test.mjs (negativa para conta sem provisionamento, expirada, suspensa ou sync_pending e retry idempotente), api/tests/integration/trial-e2e.mjs e tests/browser/access.spec.ts (disponível só em Configurações ativas, ausente nos estados bloqueados/erro em desktop/mobile). Publicação DEV acompanhada pela PR correspondente, pelos workflows oficiais.
