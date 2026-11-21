# Roteiva — Roadmap de pagamentos e assinaturas (Asaas)

> **Fonte persistente da decisão de produto.** Criado em 20/11/2026. `docs/MVP-ROADMAP.md` registra o progresso factual; `docs/ARCHITECTURE.md` registra os contratos de arquitetura. Este documento registra as regras e os critérios para retomada em outra conversa. Nunca marcar etapas como concluídas sem código, testes e evidências.
>
> **Estado inicial:** planejamento aprovado; conta Asaas PF criada, categoria "Vendo produtos → Software (licenças e programas)", documentos de identificação/ativação de produção pendentes. Não há chave de API ou webhook comprovadamente provisionados. **PROD permanece sem cobrança e sem alterações.**
>
> **Guardrails:** não comprar serviços, não habilitar cobranças reais antes de homologar, preservar DEV/PROD separados, evitar mudanças destrutivas, novas dependências não essenciais e polling contínuo; não colocar segredos em GitHub, frontend, logs, exemplos ou chat. Falta de configuração não pode derrubar login, Drive, Dropbox, autenticação, exclusão, Firestore, testes gratuitos nem concessões existentes.

## Integração Sandbox DEV — 20/11/2026

**Correção de UX da volta do checkout (21/11, DEV):** o retorno inclui ID da intenção, agenda uma reconciliação segura na inbox e faz leituras finitas de status. O webhook pode disparar conciliação antecipada pelo Worker. O workspace só reabre quando o Firestore confirmar o direito derivado de pagamento validado pelo Asaas. Após limite de espera, há instrução para não repetir a cobrança e opção de nova verificação/suporte. A especificação de checkout não declara parâmetro `autoRedirect`: não enviar flag presumida. A homologação real com Hytools e limpeza financeira para repetir o teste exigem garantir cancelamento do contrato e reversão/comprovação dos pagamentos Sandbox; jamais zerar D1 mantendo recorrência ativa.

**Configuração verificada no console.** O proprietário acessou a conta independente [Asaas Sandbox](https://sandbox.asaas.com/) e provisionou os segredos `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` no Worker `roteiva-api-dev`. O webhook Roteiva DEV v3, com envio não sequencial, aponta para `https://roteiva-api-dev.roteiva-dev.workers.dev/billing/webhooks/asaas`; a fila foi salva pausada.

**Implementação em validação.** A migração aditiva `0038_billing_reconciliation.sql` inclui coordenação de checkout, contrato, cancelamento, inbox e publicação de acesso. O Worker implementa checkout hospedado em cartão, vínculo por intenção, conciliação autoritativa, ledger, cancelamento durável e projeção Firestore com recuperação. Usuários DEV expirados podem consultar assinatura, contratar após o fim do acesso vigente e solicitar exclusão com reautenticação. O layout reutiliza Configurações e AccessGate. Consulte [procedimento e teste Sandbox](docs/DEVELOPMENT.md#integração-asaas-sandbox-no-dev).

**Decisão tomada para o primeiro ensaio.** Checkout apenas após o término de trial, cortesia ou período pago. O consentimento informa cobrança ao concluir e recorrência pelo preço do catálogo. Para trocar a cadência, cancelar a renovação e escolher o novo ciclo ao fim do acesso pago. O checkout documenta `nextDueDate`, mas o agendamento pós-trial, reativação da mesma recorrência, atualização hospedada do cartão e Pix exigem validação própria. Estornos parciais e contradições de vínculo seguem para revisão. A suspensão administrativa continua prevalecendo na autorização; a cessação de cobranças de contas suspensas exige operação de suporte e homologação.

**Evidência automatizada.** [PR #191](https://github.com/EwertonMendes/roteiva-web/pull/191). Em Windows, passaram a suíte API (353), a suíte frontend (141), o Playwright de acesso desktop/mobile (24) e as Rules do Firestore no emulador (37). A migração rodou em D1 local. Conta Google descartável autenticada em DEV com acesso expirado, verificada diretamente na projeção. O teste com cartão Sandbox aguarda o deploy.

**Sandbox real em andamento.** O deploy DEV do SHA `8c9c953151565f6d623691004a28c49b0f11703e` aplicou a 0038 ([API](https://github.com/EwertonMendes/roteiva-web/actions/runs/44768949805), [Hosting](https://github.com/EwertonMendes/roteiva-web/actions/runs/44768949746)). O webhook autentica o recebimento no Worker e sua fila está ativa. O primeiro checkout mensal foi efetivamente criado pelo Asaas com 200 e estado `ACTIVE`. A resposta real trouxe o caminho `/000/checkoutSession/show/{id}` no domínio Sandbox. A validação DEV foi ampliada para esse formato, mantendo vínculo com ID e origem. Intenções com referência já persistida são retomáveis sem novo POST.

**Homologação Sandbox da primeira compra com cartão — 20/11/2026.** Foram confirmadas as três compras hospedadas na conta descartável. Cloudflare D1 registrou checkout, assinatura e pagamento, e o Firestore restaurou o workspace automaticamente para os três ciclos. O retorno DEV mostrou “Estamos confirmando seu pagamento” até a publicação do direito. O Asaas entregou `PAYMENT_CONFIRMED` com HTTP 200 e `checkoutSession`, `subscription` e `customer` correspondentes. O D1 conciliou o estado lido da API. O cliente de cobrança criado no primeiro checkout foi reutilizado nas contratações seguintes.

| Plano | Primeira cobrança Sandbox | Período pago observado | Resultado adicional |
|---|---:|---|---|
| Mensal | R$ 39,90 | Até 20/12/2026 | Cancelamento preservou a vigência. Estorno total conciliado e acesso revogado. |
| Trimestral | R$ 109,90 | Até 20/02/2027 | Cartão de recusa manteve o workspace bloqueado. A aprovação no mesmo checkout liberou acesso. Cancelamento e estorno total conferidos. |
| Anual | R$ 399,90 | Até 20/11/2027 | Renovação cancelada pelo Roteiva, com preservação do período pago nesse ensaio. |

O [PR #192](https://github.com/EwertonMendes/roteiva-web/pull/192) corrigiu o prefixo do link observado e a retomada de intenção persistida. Código financeiro publicado no SHA `b53d7108f9d9809353023a5897f9c895298d0f56`, com [deploy API DEV](https://github.com/EwertonMendes/roteiva-web/actions/runs/44801984839), [deploy Hosting DEV](https://github.com/EwertonMendes/roteiva-web/actions/runs/44801984681) e [smoke remoto navegador/API e D1](https://github.com/EwertonMendes/roteiva-web/actions/runs/44803758781) aprovados. As duas primeiras recorrências e a anual foram encerradas no Sandbox. A ativação permanece restrita por `BILLING_CHECKOUT_TEST_UID`; a conta PF do Asaas de produção ficou fora desta execução.

**Pendências para ativação geral.** A renovação automática e a inadimplência de cartão ainda precisam de um ciclo futuro real ou de simulação oficial de fatura recorrente. O painel Sandbox oferece carnê somente para boleto. O processamento de renovação, atraso de três dias, regularização, reversão de cobrança antiga, chargeback e falha de projeção passou em teste isolado. Permanecem pendentes estorno parcial e chargeback reais, atualização hospedada de cartão, suspensão da recorrência para contas suspensas, atraso com renovação real, exclusão remota sob falha financeira e recuperação da criação perdida quando o Asaas omite `externalReference`. O ensaio de estorno parcial via painel manteve a cobrança anual confirmada e ficou sem confirmação de reversão. A suíte API com 354 testes cobre a parada do checkout durante exclusão e a preservação do vínculo quando o provedor fica indisponível. A elegibilidade do Pix Automático exige conta PJ, e Pix comum permanece fora da oferta. Confirmar política de retenção e orçamento de CPU sob carga antes de promover. [Limites do Sandbox](https://docs.asaas.com/docs/o-que-pode-ser-testado) · [FAQ Pix Automático](https://docs.asaas.com/docs/faq-2).

### Homologação de upgrades no Sandbox

Em 20/11/2026, a conta QA realizou três contratações fictícias pelo checkout com cartão de teste, seguidas de upgrades em **Configurações → Assinatura → Fazer upgrade**. O teste usou a API publicada no SHA `de8dbff` ([PR #195](https://github.com/EwertonMendes/roteiva-web/pull/195)). O preço e o ciclo mudaram na mesma assinatura do Asaas. O vencimento foi mantido, nenhuma cobrança imediata foi gerada, e o Roteiva manteve o plano pago vigente.

| Troca | Próxima cobrança agendada | Vencimento conferido |
|---|---:|---|
| Mensal → trimestral | R$ 109,90 | 20/12/2026 |
| Mensal → anual | R$ 399,90 | 20/12/2026 |
| Trimestral → anual | R$ 399,90 | 20/02/2027 |

As recorrências dos dois testes mensais foram canceladas e suas primeiras cobranças estornadas no Sandbox para isolar os ensaios. O plano trimestral e seu upgrade anual foram deixados agendados para conferência. As próximas faturas de cartão ainda não existiam durante o teste. O painel ofereceu a geração de carnê somente para boleto. A alteração de uma fatura já emitida e a ativação após uma renovação de cartão foram exercitadas nos testes de API com respostas simuladas. A confirmação no provedor desses dois cenários permanece pendente. [Comportamento das cobranças recorrentes](https://docs.asaas.com/docs/faq-assinaturas).

Na revalidação de 20/11/2026, o painel do Sandbox recusou estornar parcialmente R$ 10,00 da cobrança fictícia feita no mesmo dia e informou que o estorno parcial só pode ser solicitado no dia seguinte. O ensaio não alterou a assinatura de QA. A conciliação de estorno parcial e a corrida entre cancelamento, resposta perdida do upgrade e confirmação tardia passaram com respostas simuladas.

## 1. Decisões de produto

- **Um só nível funcional** (acesso completo) em três contratos: `monthly` R$ 39,90 (3.990 centavos, `MONTHLY`), `quarterly` R$ 109,90 (10.990 centavos, `QUARTERLY`) e `yearly` R$ 399,90 (39.990 centavos, `YEARLY`). Uma única moeda BRL.
- A periodicidade é frequência de cobrança, **não tiers**; o frontend nunca determina quantia, moeda, prazo ou identidade por conta própria. Configuração de catálogo centralizada no servidor, versionável e protegida; mudanças de preço para novas vendas não alteram assinaturas antigas sem consentimento e notificação apropriada.
- **Trial de sete dias por identidade Google, imutável**, sem cartão e sem cobrança automática no cadastro. Não criar free tier permanente nesta etapa. Cortesias temporárias e vitalícias continuam independentes; não estender nem apagar histórico.
- Cancelamento voluntário: interromper próximas cobranças e conservar acesso até o final do período já pago (sem estorno automático). Descrever a data de término antes de confirmar.
- Inadimplência: tolerância atual do acesso de até **três dias** para assinaturas `past_due`; não aplicar tolerância extra a cancelamentos ou estornos. Propor aviso em D-3, D-1, D0 e período de tolerância no app; evitar spam e notificações pagas por padrão. Definir políticas de notificação financeira do Asaas explicitamente.
- Troca de periodicidade: por padrão agendar para a próxima renovação, **sem pró-rata** na primeira versão; evitar duas recorrências simultâneas, cobranças duplas e faturas pendentes de contrato antigo. Se API/checkout não suportar agendamento seguro, oferecer escolha apenas quando for possível garantir o fluxo; nunca simular alteração silenciosa.
- Contratar antes do fim de trial/cortesia: preservar dias de acesso já concedidos e **não cobrar antes da data acordada**. Validar em Sandbox as capacidades de primeiro vencimento e checkout. Se não houver capacidade confiável, expor data real da primeira cobrança e exigir consentimento expresso; não afirmar que agendamento está funcional.
- Métodos de pagamento: **cartão de crédito com recorrência automática** como primeiro fluxo; Pix comum pode exigir que o usuário pague manualmente cada ciclo, embora os webhooks confirmem automaticamente o acesso. Pix Automático depende de elegibilidade PJ e homologação; não prometer na conta PF. Não assumir parcelamento ou assinatura automática Pix sem confirmação documental.
- Conteúdo das telas: planos, comparação de periodicidades, preço total, equivalência mensal quando útil, renovação, método, data da próxima cobrança, status, histórico, atualizar cartão quando disponível, cancelar, reativar e regularizar. Não vender recurso como pronto quando a API estiver desabilitada.
- Usar checkout **hospedado**, sem coletar PAN/CVV ou dados sensíveis de pagamento na UI/Worker. Redirect/callback nunca confirma compra.
- Expiração preserva projetos, revisões e mídia. Bloquear operações comerciais via Worker/Firestore sem bloquear *billing/status, checkout, regularização, suporte, logout nem solicitação de exclusão* com reautenticação.
- Estorno/chargeback: reavaliar períodos pagos associados à cobrança e demais direitos vigentes, revogando o benefício relacionado ao pagamento reverso; jamais suprimir outra cortesia ou pagamento legítimo. Casos financeiros complexos exigem revisão operacional. Suspensão de segurança prevalece, mas fluxo de cobrança deve ser suspenso/analisado, evitando cobrança de serviço não prestado.
- Data/hora: armazenar instantes de acesso em UTC ms e **datas de vencimento em data civil da conta** quando API exigir `YYYY-MM-DD`; não somar 30/90/365 dias para contratos de calendário. Provedor decide a recorrência. Exibir horário em pt-BR, inclusive fuso, quando necessário.
- Sem painel administrativo no Roteiva. Ações excepcionais usam operação separada, auditada, com privilégios específicos, não uma rota pública.

## 2. Arquitetura e limites

Fluxo: React + Firebase Auth → Cloudflare Worker existente → adaptador Asaas (API REST) → checkout hospedado. Asaas → webhook **autenticado** no Worker → evento durável D1 → processamento idempotente → direito no D1 → projeção `users/{uid}/access/current` no Firestore → listener UI, Rules e endpoints Worker. **D1 é fonte oficial de contratos e pagamentos; o Firestore é projeção de autorização, nunca cobrança.**

- Reutilizar `api/src/access.ts`, `access_accounts`, `access_grants`, `access_subscriptions`, `sync_pending`, `AccessGate`, `watchAccess`, Firestore Rules atuais e migrações aditivas. Não resetar trial nem concessões. `access_subscriptions` existente comporta cadência/status/período pago, mas precisa de informações adicionais ou tabelas vinculadas para histórico e compensações.
- Usar `provider`, referências externas por ambiente, `plan_code` estável, valores em centavos, `pricing_version` e status genéricos. Interface pequena de provedor; sem arquitetura de plugins ou abstrações genéricas antecipadas. Troca futura de gateway exigirá migração explícita de contratos recorrentes, não apenas trocar uma URL.
- Tabelas mínimas quando o fluxo estiver ativo: vínculo UID → customer Asaas (único por ambiente), intenções/checkouts com chave idempotente e validade, pagamentos (ID do provedor, status, valor, período pago, referência à assinatura), eventos de webhook com `event_id` único, controle de tentativas e reconciliação. Índices por status/prazo; nunca persistir cartão, dados bancários, tokens de checkout reutilizáveis ou payloads brutos não necessários.
- Segurança: validar Firebase JWT e perfil existente nas rotas do usuário; não requerer assinatura ativa para contratar/regularizar/cancelar/excluir; proteção contra CSRF/Origin já existente, rate limit por UID e IP; impedir cobrança duplicada em abas concorrentes. Não confiar em `uid`, preço, valor, email ou provider ID vindos do cliente. ID do cliente Asaas sempre vinculado no servidor ao owner; separar os ambientes.
- Para webhooks: validar `asaas-access-token` contra segredo **exclusivo** do webhook (não é API key), limite de tamanho de corpo, tipo de evento e formato; registrar evento antes do HTTP 200, rejeitar inválidos e duplicatas sem efeitos, evitar consultar o Asaas a cada webhook salvo quando a documentação exigir ou houver dúvida. Eventos chegam fora de ordem; transitions baseadas no estado autoritativo do pagamento e em reconciliação, não em ordem temporal de recebimento.
- Resolver inconsistência D1/Firestore com transição durável, fence `sync_pending`, CAS em Firestore, reconciliação de pendências e negação conservadora quando estado é incerto. Não deixar fence permanentemente travada por perda de resposta; liberar só após verificar ambos os sistemas. Evitar conceder acesso por evento `CHECKOUT_PAID` sem confirmar pagamento e vínculo ao contrato/UID.
- O webhooks respondem 2xx **após persistência do evento**, não após finalizar todo processamento; filas podem ser tabela D1 + Cron atual com lotes pequenos. Usar o mínimo de D1 e chamadas Firestore; revalidar apenas divergências, pagamentos incertos e assinaturas próximas do fim.
- Segredos: `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` opcionais, exclusivos em cada Worker; checagem de modo de ambiente impede DEV → endpoint real ou PROD → sandbox. Flag `BILLING_ENABLED` default `false`; ausências retornam status `available:false` ou erros limitados somente às rotas billing, sem atrapalhar CI/deploy. Não usar segredo de DEV como fallback em PROD. Configurar sem assumir mensalidade, serviço de fila pago ou plano Workers Paid.
- **Até homologação:** não expor endpoint público que faça cobrança, não ligar `BILLING_ENABLED`, não criar assinatura real e não adicionar código que solicite credenciais como pré-condição de carregamento. Catalogo estático no backend pode ser público desde que não anuncie cobrança ativa.

## 3. Eventos e política de máquina de estados

| Evento de domínio | Efeito autorizado |
|---|---|
| Login/registro | Valida perfil e trial como hoje, nunca cria cobrança |
| Checkout criado | `pending`; **sem acesso pago** |
| Checkout expirou/cancelou | Marca intento, libera nova tentativa segura; sem acesso |
| Payment criado/pendente | Conciliação apenas; sem novo acesso |
| Payment confirmado/recebido | Registra evento financeiro e período pago, atualiza `paid_until` apenas 1x |
| Payment atrasado/recusado | Marca situação de cobrança; `past_due` e tolerância se aplicável |
| Payment reembolsado/chargeback | Reverte direito atribuído à cobrança, mantendo direitos independentes |
| Subscription atualizada | Atualiza contrato/renovação futura sem declarar pagamento |
| Subscription cancelada | Para novas cobranças; acesso até `paid_until`, desde que não haja reversão |
| Recovery/reconciliação | Resolve `unknown` após consulta limitada à API; nunca inventa pagamento |
| Exclusão de conta | Interrompe cobrança externa antes de apagar vínculo/identidade; falha mantém job seguro e retomável |

**Situações excepcionais obrigatórias:** primeiro webhook perdido, duplicado, com atraso ou fora de ordem; 429/5xx do Asaas; sucesso financeiro com falha Firestore; duas abas iniciando checkout; usuário troca conta entre checkout/retorno; atualização de preço durante checkout; alteração agendada antes da renovação; data civil no fim do mês/ano bissexto; cobrança gerada antes da troca; retries pós-timeout; concorrência com exclusão; cancelamento entre pagamento e webhook; Pix pago depois de vencido; chargeback após nova renovação; cortesia + contrato ativo; suspensão + cobrança; credenciais ausentes e desligamento da flag; callback enganoso; env errado; cotas e rate limit excedidos.

## 4. Plano executável por fases

### Fase 0 — Inventário e decisões **PLANEJADO**
- [ ] Confirmar no Sandbox/conta real: checkout recorrente por cartão, fluxo trimestral/anual, datas de primeira cobrança, tokenização necessária para atualização, pré-aviso e notificações cobradas, callbacks, IDs e tipos reais dos eventos, cancelamento e reversões.
- [ ] Confirmar documentos Asaas e elegibilidade; API real **somente após** aprovação e ensaio controlado. Registrar política fiscal, termos comerciais, cancelamento/reembolso e retenção de dados com responsável.
- [ ] Identificar dependências atuais da pipeline, acesso e exclusão; medir baseline de custo. Não alterar PROD.

### Fase 1 — Fundação independente do Asaas **PUBLICADA E VALIDADA EM DEV (cobrança DESLIGADA)**
- [x] Salvar este roadmap na raiz e referenciar fontes de verdade.
- [x] Catálogo imutável (BRL, centavos, periodicidade, preço de versão) + testes.
- [x] Cliente HTTP de Asaas tipado, endpoints fixos por ambiente, timeout, JSON validado, mensagens de erro sanitizadas, nunca registrar token ou corpo. **Isolado, não chamado pelo app**.
- [x] Endpoint de leitura `GET /billing/plans` com `checkoutAvailable:false`, sem qualquer autorização para cobrar; flags/chaves opcionais.
- [x] Migração `0035_billing_foundation.sql` aditiva e testes de integridade para tabelas de customer/checkout vazias; **sem gravar dados financeiros reais**.
- [x] CI PR verde ([API](https://github.com/EwertonMendes/roteiva-web/actions/runs/44669406115), [isolada](https://github.com/EwertonMendes/roteiva-web/actions/runs/44669406036)), [merge PR #176](https://github.com/EwertonMendes/roteiva-web/pull/176), publicação [API DEV #44669884336](https://github.com/EwertonMendes/roteiva-web/actions/runs/44669884336) e smoke de `/health`/JWT inválido. Sem alteração PROD. Checkout continua não implementado.
- [x] Smoke público no DEV `GET /billing/plans` (preços exatos, checkout indisponível), `POST /billing/checkout` 404, `GET /health` 200 e JWT inválido 401 no [workflow API DEV #44670412441](https://github.com/EwertonMendes/roteiva-web/actions/runs/44670412441), após [PR #177](https://github.com/EwertonMendes/roteiva-web/pull/177), SHA `2b4d9c1d18d410b96e01a0d8c0da299fc8cdcbaf`. Apenas fundação; **nenhuma cobrança habilitada**.

### Fase 1.5 — Inbox de webhooks Asaas independente da conta **PUBLICADA/VALIDADA EM DEV; DESATIVADA POR PADRÃO**

- [x] Código de recepção `POST /billing/webhooks/asaas`, limitado a DEV e opt-in com `BILLING_ENABLED` + ambos segredos; ausência de config = 404 sem impacto nas demais rotas.
- [x] Autenticação por `asaas-access-token`, limite de 64 KiB, parse tolerante a campos novos, persistência mínima idempotente em `0036_billing_webhook_events.sql`, sem payload bruto ou dados de cartão.
- [x] Responder 200 só após `INSERT OR IGNORE` confirmado; D1 indisponível = 503. Status de eventos `pending/review`, sem processar ou conceder acesso.
- [x] [PR #179](https://github.com/EwertonMendes/roteiva-web/pull/179), merge SHA `8733635e1422bae9ad41662f1ab3f4b62eb3a22d`, [testes API #44672092578](https://github.com/EwertonMendes/roteiva-web/actions/runs/44672092578), [regressão isolada #44672092583](https://github.com/EwertonMendes/roteiva-web/actions/runs/44672092583) e [deploy DEV #44672491507](https://github.com/EwertonMendes/roteiva-web/actions/runs/44672491507) aprovados. Migração D1 aplicada, Worker publicado, smoke remoto de `/billing/webhooks/asaas` desativado (404). **Não houve cobrança, concessão ou publicação PROD.**
- [ ] Próximo passo após Sandbox: ativar manualmente somente DEV, configurar webhook Asaas com token próprio, executar entrega real e reconciliação. Sem autorização de PROD.

### Fase 1.6 — Contratos de checkout, ledger e consulta de assinatura **PUBLICADA E VALIDADA EM DEV**

- [x] Função pura de geração de checkout Asaas com cartão recorrente, ciclos mensal/trimestral/anual, valor no catálogo do backend, externalReference UUID e callback restrito ao domínio do ambiente.
- [x] Modelo conservador de eventos: pagamento confirmado/recebido, atraso, estorno, chargeback, checkout e assinatura demandam reconciliação; nenhum evento libera acesso diretamente.
- [x] Migração aditiva `0037_billing_payment_ledger.sql` cria ledger vazio para futura conciliação; unicidade de referência e FK composta impedem vincular pagamentos a dono diferente da assinatura.
- [x] `GET /billing/status` autenticado e somente de leitura, disponível também para conta expirada, retornando status e validade do acesso existente; **checkoutAvailable:false**, sem chamadas ao Asaas.
- [x] [PR #181](https://github.com/EwertonMendes/roteiva-web/pull/181) mergeada no SHA `5ae228baf4f759589f76af974fea25aa4bcec855`; CI [API #44673673506](https://github.com/EwertonMendes/roteiva-web/actions/runs/44673673506), [E2E #44673673525](https://github.com/EwertonMendes/roteiva-web/actions/runs/44673673525) e [deploy DEV #44674072841](https://github.com/EwertonMendes/roteiva-web/actions/runs/44674072841) aprovados. Migração `0037` aplicada, Worker DEV publicado e smoke de saúde/autenticação aprovado. Nenhum pagamento ou alteração PROD.
- [ ] Aguardando Sandbox: definir data segura da primeira cobrança, criar checkout real e associar intent, tokenização, confirmação de pagamento, reconciliação e projeção Firestore.

### Fase 1.7 — Avisos de ciclo de vida sem gateway **PUBLICADO E VALIDADO EM DEV**

- [x] Motor puro de avisos de leitura: trial e cortesia em D-3/D-1, assinatura em renovação, cancelamento no fim de período pago, `past_due` com tolerância e suspensão administrativa.
- [x] `GET /billing/status` devolve `notice` calculado do direito efetivo, respeitando cortesia/vitalício e sem duplicar gravações ou disparar SMS/e-mail.
- [x] Testes de bordas temporais, prioridades de entitlement e ausência de escrita/efeito financeiro.
- [x] [PR #183](https://github.com/EwertonMendes/roteiva-web/pull/183), merge SHA `c246ebd03b0d01fbf8aae2164b34728b9cd3c28b`, CI API [#44675122616](https://github.com/EwertonMendes/roteiva-web/actions/runs/44675122616) e deploy DEV [#44675298640](https://github.com/EwertonMendes/roteiva-web/actions/runs/44675298640) aprovados. O checkout permanece desligado, nenhum efeito financeiro ocorreu, frontend de cobrança segue planejado e PROD não foi modificado.
- [ ] Confirmar em Sandbox a regra efetiva de Pix PF: o Asaas documenta `CONFIRMED` temporário durante bloqueio cautelar de até 72h; não confiar apenas neste estado para liberar acesso. Fonte: https://docs.asaas.com/reference/criar-nova-cobranca

### Fase 2 — Sandbox checkout **VALIDADO PARA CARTÃO NA CONTA DE QA**
- [x] Confirmar contrato JSON do POST /v3/checkouts e link real do Sandbox com prefixo `/000/`.
- [x] Criar checkout autenticado com intenção única, limite por UID, consentimento e catálogo no backend.
- [x] Verificar retorno DEV que aguarda a projeção do acesso. Teste de recusa validado no checkout trimestral.
- [ ] Homologar Pix comum com fluxo explicitamente distinto.
- [x] Executar primeira compra mensal, trimestral e anual com dados fictícios e CI isolada.

### Fase 3 — Confirmação financeira/entitlement **PLANEJADO**
- [ ] Webhook com segredo próprio, persistência durável e dedup; worker de conciliação / leases e retries com limite.
- [ ] Mapear eventos reais de pagamento e assinatura do Asaas e acompanhar recorrências. Não ampliar direito por evento meramente de checkout/cobrança gerada.
- [ ] Aplicar alteração idempotente com fence e CAS de projeção; monitorar falhas parciais e restauração de acesso em tempo real.
- [ ] Cobertura de duplicidade, ordem inversa, concorrência, reversão, exclusão e isolamento A/B.

### Fase 4 — Fluxo de produto **PLANEJADO**
- [ ] UI de planos mensal/trimestral/anual acessível em cadastro expirado/suspenso conforme autorização; criar caminho de cobrança fora do `AccessGate` comercial sem abrir workspace.
- [ ] Configurações: status, prazo, histórico, próxima cobrança, cancelamento, comprovantes/links Asaas. Informar quando Pix requer ação mensal.
- [ ] Ajustar exclusão de conta expiradas sem enfraquecer reautenticação/isolamento; cancelar renovação antes de finalizar saga.
- [ ] Avisos no app de trial/cortesia D-3/D-1/vencido, fatura em aberto e tolerância, sem alertas invasivos nem polling.

### Fase 5 — Política completa de ciclo **PLANEJADO**
- [ ] Cancelamento e reativação; cobrança recusada, tolerância D+3 e expiração; reconciliação do pagamento tardio e reembolso; histórico de contratos antigos.
- [x] Validar o agendamento mensal → trimestral, mensal → anual e trimestral → anual na mesma recorrência de cartão do canário DEV. Ver [evidências do upgrade](#homologação-de-upgrades-no-sandbox).
- [ ] Confirmar no Asaas Sandbox o upgrade com fatura já gerada e a primeira renovação de cartão no novo ciclo.
- [x] Regressões de renovação e cancelamento com fatura existente, disputa com upgrade e confirmação atrasada. O ledger deixa de mostrar faturas canceladas como pagáveis.
- [x] Conciliar estorno parcial concluído pelo Asaas, manter a maior soma comprovada e recalcular a vigência sem a cobrança parcialmente estornada. Mesma fatura e total original preservados para análise.
- [ ] Proteger preço histórico; alterações de catálogo não modificam silenciosamente assinaturas existentes.
- [ ] Notificações financeiras gratuitas via próprio Asaas apenas quando configuradas conscientemente; e-mail próprio transacional requer projeto próprio, sem serviço pago automático.

### Fase 6 — Homologação e rollout **PLANEJADO/BLOQUEADO POR APROVAÇÃO ASAAS**
- [ ] CI: testes unitários de catálogo/adaptador, D1 local, Firebase Rules A/B, Playwright emuladores sem rede de pagamento; cenários reais Sandbox com identidades descartáveis, sem PROD.
- [ ] Conta Asaas com documentação aprovada e teste de retorno do dinheiro real em operação controlada, mediante autorização; conferência de tarifas, descontos e prazo de repasse.
- [ ] Configuração separada de segredos DEV/PROD e `BILLING_ENABLED` somente quando cada ambiente estiver completo. No PROD, pipeline protegida com gate manual, observabilidade e rollback funcional sem apagar banco.
- [ ] Checklist de 24-48h pós-publicação: health, listener, projeções, webhooks, reinício, volume de eventos, D1/Firestore/Workers free quotas, sem cobrança duplicada.
- [ ] Documentar evidencia de pagamentos, cancelamento/estorno/reativação e aprovações. Registrar caminho de suporte e recuperação manual com menor privilégio.

## 5. Custos/limites e segurança operacional

- Cloudflare Workers Free e D1 Free + Firestore Standard/Spark são restrições do produto. **Não prometer custo zero em qualquer escala.** Medir uso real das cotas compartilhadas, não assumir capacidade infinita. Evitar polling por assinatura; filtros/indexes e reconciliação só de exceções; reutilizar crons `* * * * *` e `*/15 * * * *` com orçamento curto, sem novas filas pagas.
- Não usar frontend para conferir preços, status ou comprovantes; nunca armazenar nem exibir credenciais. Desabilitar auto-recuperação destrutiva de migrações. Migrations apenas aditivas e versionadas; reversão de código preserva tabelas e contratos.
- Asaas cobrança tem **tarifa por transação**, taxa por canal e tarifa de notificação/antecipação potencial; preços são sugestão de venda, não lucro. Monitorar taxas atuais e contas homologadas. Exemplo com cartão padrão 2,99% + R$0,49: sobre R$39,90 sobra ~R$38,22 antes de tributos, infra e suporte; não usar taxa promocional para definir margem.
- Arquivos essenciais atuais: `api/src/access.ts`, `api/migrations/0007_access.sql`, `api/migrations/0009_access_sync_fence.sql`, `api/src/index.ts`, `src/features/access/AccessGate.tsx`, `src/data/access-watch.ts`, `firestore.rules`, `api/src/account-deletion.ts`, `.github/workflows/api.yml`, `docs/ACCESS-CONTROL.md`.
- URLs oficiais para revalidar contratos: https://docs.asaas.com/docs/asaas-checkout ; https://docs.asaas.com/reference/create-new-checkout ; https://docs.asaas.com/docs/checkout-with-subscription-recurring ; https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook ; https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1 ; https://docs.asaas.com/docs/sandbox .
- **Runbook de falha:** desligar a feature flag de novas contratações sem cancelar contratos existentes; preservar recibos e eventos; diagnosticar IDs categóricos sem PII; reconciliar eventos com provedor quando restabelecido; emitir correção aditiva, jamais apagar o D1 para refazer uma assinatura.

## 6. Contrato para próximas conversas

1. Ler este arquivo, `AGENTS.md`, `docs/MVP-ROADMAP.md` e o código atualizado; verificar PRs/migrations/CI reais antes de assumir progresso.
2. Marcar explicitamente o que está **PLANEJADO**, **IMPLEMENTADO**, **VALIDADO** e **BLOQUEADO**, citando SHA e workflow. Não inferir homologação pela existência do código.
3. Continuar a fase pendente em branch + PR, testar e publicar **somente DEV** quando solicitado; PROD exige autorização separada.
4. Não solicitar nem exibir chaves em conversa. O proprietário provisiona segredos em ambiente protegido quando disponíveis, sem alterá-los na tentativa de consertar deploy.
5. Garantir que ausência de todos os segredos Asaas mantenha o Roteiva operacional como antes. O pagamento é **opt-in** por flag e confirmação financeira exclusivamente no servidor.
