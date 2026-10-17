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
| Worker API separado e D1 de tokens | **PLANEJADO** | Não existe Worker OAuth/refresh do MVP |
| Drive individual por usuário | **PLANEJADO** | Integração BRBET inspecionada externamente; não transferida |
| Revisão segura por cliente | **PLANEJADO** | Fluxo legado incompatível com arquitetura-alvo |
| Planos/entitlements | **PLANEJADO** | Não há verificação server-side de assinatura |

## Evolução de onboarding — cadastro separado (PR #9)

**Status inicial: IMPLEMENTADO, aguardando validação do CI e publicação DEV.**

- [x] Diferenciar **Entrar** e **Criar conta** mantendo Google como único login.
- [x] Não criar perfis Firestore em login ou restauração de sessão; apenas depois da confirmação do formulário.
- [x] Consultar perfil existente sem escrita, preservar usuários antigos e dados das PRs #6–8.
- [x] Criar formulário responsivo com nome, estúdio opcional, tipo de trabalho e ciência do uso de dados no ambiente DEV, sem inventar Termos/Política formais.
- [x] Regras: exigir dados completos em novos perfis, timestamps imutáveis, manter compatibilidade para contas existentes e negar acesso entre UIDs.
- [x] Preservar a demonstração sem Firebase e a chave `localStorage`.
- [ ] Validar em CI: testes de regras/perfil legado, registro explícito, login/cadastro e navegador desktop/mobile.
- [ ] Publicar após CI verde e verificar fluxo real no DEV sem afetar registros existentes.
- [ ] Antes de abrir cadastro público: providenciar e revisar Termos de Uso, Política de Privacidade, canal de suporte e processo de exclusão de conta/dados.

**Escopo:** separação entre identidade Google e cadastro de negócio. Não confundir checkbox DEV com aceite jurídico definitivo.

## Fase 0 — Prova técnica mais arriscada: Google Drive + Worker

**Prioridade P0.** Fazer **antes** de migrar a biblioteca completa, para validar que é possível usar Drive com segurança e arquivos grandes sem proxy.

- [ ] PoC Worker TypeScript publicado em ambiente DEV no plano gratuito.
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

**Prioridade P0.** Por solicitação explícita na PR #6, Auth/Firestore Solo são independentes da PoC Drive da Fase 0. Worker/OAuth continuam planejados.

- [x] Unificar React/Vite/TS na SPA em `src/`, mantendo visual, estado local e build Pages; preparar build Firebase em `dist/` (PR #5).
- [x] Padronizar lockfile/instalação com PNPM, removendo o npm lock e instaladores órfãos (higienização PR #3); **a auditoria de dependências em si continua pendente**.
- [x] Reutilizar exclusivamente Firebase **DEV** roteiva-web-dev: Hosting ativo, Auth Google habilitado, Firestore Standard criado em São Paulo após aprovação. **PROD não autorizado e não criado**.
- [x] Implementar login Google, logout, sessão, proteção e erros na PR #6; **IMPLEMENTADO**, QA real ainda pendente.
- [ ] Criar cliente HTTP para Worker, com Firebase ID Token e tratamento de expiração/401; sem compartilhar UID arbitrário.
- [ ] Criar API Worker DEV/PROD separada, secrets/bindings por ambiente e CORS controlado.
- [x] CI com typecheck, testes, ambos builds e emuladores; deploy DEV automático após master verde (PR #6).
- [ ] Acrescentar lint e previews; PROD continua separado e não provisionado.
- [ ] Configurar observabilidade de erros/cotas e documentação de configuração/deploy.
- [ ] Testar mobile, desktop, tema e navegação acessível.

**Aceite:** dois usuários entram em contas distintas, reiniciam sessão, veem telas protegidas; regras verificam identidade; Worker/PROD continuam futuros; CI verde. **Estado:** PARCIAL — fundação Solo implementada, QA e demais subetapas discriminados abaixo.

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

**Próxima entrega:** concluir QA Google real do DEV publicado na PR #6. Depois, PoC Drive da Fase 0, sem antecipar Worker/D1 nesta entrega.

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
