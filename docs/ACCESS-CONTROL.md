# Controle de acesso SaaS — rollout DEV

## Estado atualizado — 19/10/2026 (horário de Brasília; deploys registrados em 20/10 UTC)

**IMPLANTADO EM DEV; HOMOLOGAÇÃO REAL PARCIAL:** migrations 0007/0008/0009, Worker final, frontend integrado e regras comerciais restritivas foram publicados pelos pipelines oficiais. As três contas existentes receberam projeções válidas e cortesia fixa; backfill concluído. A conta existente confirmou cortesia e listagem de quatro arquivos Drive sem reconexão ou alteração dos arquivos. A fixture Google autorizada concluiu cadastro e segundo login: trial exato de sete dias, sem beta grant; repetição preservou prazo/updateTime da projeção. Suspensão retirou o workspace da sessão ativa e resistiu à reverificação; cortesia reativou acesso sem alterar trial nem o projeto descartável salvo. Após login manual recente, o pedido de exclusão foi aceito; saga em processamento, última fase revoking sem erros. Conclusão ainda não confirmada. Expiração e isolamento A/B remotos ainda não foram homologados.

| Entrega | Evidência de publicação DEV |
| --- | --- |
| Infraestrutura, PR #43 | [API 39354281435](https://github.com/EwertonMendes/roteiva-web/actions/runs/39354281435), merge `8169177` |
| Provisionamento, PR #44 | [API 39355067084](https://github.com/EwertonMendes/roteiva-web/actions/runs/39355067084), [regras preparatórias 39355067202](https://github.com/EwertonMendes/roteiva-web/actions/runs/39355067202), merge `f3efb63` |
| Diagnóstico, PR #45 | [API 39355610134](https://github.com/EwertonMendes/roteiva-web/actions/runs/39355610134), merge `2d1bd62` |
| Correção runtime, PR #46 | [API 39356216592](https://github.com/EwertonMendes/roteiva-web/actions/runs/39356216592), merge `5734a1a` |
| Frontend, PR #47 | [Hosting 39356744391](https://github.com/EwertonMendes/roteiva-web/actions/runs/39356744391), merge `f45927d` |
| Enforcement, PR #48 | [API 39358435356](https://github.com/EwertonMendes/roteiva-web/actions/runs/39358435356), [regras finais 39358435474](https://github.com/EwertonMendes/roteiva-web/actions/runs/39358435474), merge `b0ae124` |

Validação automatizada final: 82 testes API, 27 unitários frontend, 30 testes Rules e 55 Playwright desktop/mobile aprovados (três skips previstos); TypeScript, builds e migrations locais até `0009` aprovados. Essas evidências não substituem os cenários remotos pendentes. DEV: [aplicação](https://roteiva-web-dev.web.app). Não houve alteração PROD, cobrança, IAM ou proteções GitHub.

**Decisão confirmada pelo proprietário em 19/10/2026:** manter **30 dias** de cortesia para a coorte DEV existente por enquanto, sem extensão automática para três meses. É uma concessão finita, contada do marco fixo da migração, e separada do teste único de sete dias. Novos cadastros recebem somente o teste. O provisionamento deve usar um marco de migração fixo e identificador determinístico da concessão; repetir não reinicia os prazos. Nenhuma tela ou endpoint ADM pertence ao Roteiva.

## Sequência histórica da publicação coordenada (concluída)

> As etapas 1–4 abaixo já foram executadas pelas PRs #43–#48. Não são instruções para repetir migrações ou republicar componentes. A verificação remota final permanece parcial conforme o quadro de homologação.

1. Merge desta entrega de infraestrutura na master; `API DEV` aplica migrations com o ambiente `cloudflare-development` protegido. Conferir contagens anteriores/posteriores, esquema, índices, trigger e `foreign_key_check` antes de publicar o Worker compatível. Sem substituição de banco.
2. Entrega do Worker com provisionamento e compatibilidade temporária explicitamente limitada às contas anteriores ao marco; contas suspensas/expiradas já provisionadas nunca podem usar essa compatibilidade. Autenticação, propriedade, exclusão, Origin e rate limits continuam obrigatórios. Falhas de dependência negam operação.
3. Publicar frontend integrado pelo pipeline oficial após confirmar Worker pronto. Provisionar todas as contas anteriores ao marco de forma idempotente, sem tocar documentos de negócio; verificar D1 e projeções Firestore.
4. Encerrar compatibilidade do Worker somente após inventário sem lacunas e homologação real. Publicar regras restritivas em entrega separada, após essa verificação. Nunca incluir essas regras no merge inicial da PR #42.
5. Homologar cadastro, login repetido, cortesia, expiração, suspensão/reativação, isolamento A/B, Drive e exclusão exclusivamente de fixtures descartáveis. CI/emuladores não comprovam essas operações no DEV.

**Estado atual:** a PR #42 foi encerrada sem merge por ter sido substituída pelas PRs #43–#48, já integradas à `master`. **Não reabrir nem mesclar a #42.** O procedimento seguro de publicação continua exigindo `master`, pipelines oficiais e proteção dos ambientes.

## Infraestrutura auditada

Em 19/10/2026, a API Google confirmou a conta `account-deletion-dev@roteiva-web-dev.iam.gserviceaccount.com` ativa e exclusivamente vinculada ao papel `roteivaAccountDeletion`: `datastore.entities.create/get/list/update/delete` e `firebaseauth.users.delete`. Essas permissões bastam para ler perfil e criar/atualizar a projeção; não é necessário criar outra credencial ou ampliar IAM. IAM não limita esses documentos por UID: o backend deve fazê-lo.

Bindings reais do Worker confirmaram `FIREBASE_ADMIN_CREDENTIALS_JSON` como `secret_text`, `ACCOUNT_DELETION_ENABLED=true`, projeto DEV, DB e ambos rate limiters. Conteúdo do segredo não foi lido. Após a correção da PR #46, o Cron criou as três projeções, comprovando o funcionamento da credencial instalada para ler perfis e publicar acesso. Health Worker e Hosting responderam 200. Sessão Wrangler renovada; o token local não possui escopo D1 (403), portanto migração remota usa o pipeline autorizado existente, sem criar token duplicado.

Console Cloudflare: 89/100.000 requisições Worker no dia; D1 aproximadamente 7 mil linhas lidas, 3 escritas e 98,3 kB nas últimas 24h no instante consultado. São métricas anteriores ao rollout, não estimativas de consumo do controle novo. Regras comerciais acrescentarão leitura da projeção; medir no Console Firebase, considerando cache de chamadas de regras.

Consulta às APIs de billing/Monitoring em 20/10/2026 02:11 UTC: billing desabilitado e 209 leituras/6 escritas Firestore nas 24h anteriores. Métricas têm atraso e não comprovam consumo futuro ou custo das regras finais ainda não publicadas. Não somar métricas antigas e novas que representam as mesmas operações. Para comparação após ativação, repetir a mesma janela e observar requisições Worker; não ampliar plano por conveniência.

## Migração e reversão

`0007` somente cria três tabelas, dois índices e trigger. Trial dura exatamente 604.800.000 ms e datas/UID não podem mudar por UPDATE. Cortesia temporária exige fim não nulo e posterior ao início; concessões/assinaturas têm FK com cascata. Não remove nem altera tabelas OAuth/exclusão. Teste SQLite compara integralmente a conexão preexistente antes/depois e valida constraints/FK/cascata.

O pipeline registra apenas nomes de migrations/esquema e contagens, nunca UID, email ou tokens. Se contagens mudarem por atividade concorrente, interromper e investigar antes de publicar; igualdade de contagens não comprova igualdade de conteúdo sozinha. A natureza aditiva da migration e teste de preservação complementam essa evidência.

Rollback desta fase: retornar código Worker ao commit anterior pelo pipeline protegido, **manter `0007` e todos os dados**. Não executar DROP, não editar migration aplicada, não restaurar o D1 inteiro sobre gravações recentes. Antes de eventual recuperação de desastre, capturar um bookmark e avaliar o impacto de Time Travel com o proprietário. Rollback posterior não pode restaurar regras permissivas para contas suspensas: manter regras restritivas e corrigir infraestrutura/projeções.

Referências: [migrations D1](https://developers.cloudflare.com/d1/reference/migrations/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [limites Firestore](https://firebase.google.com/docs/firestore/quotas).

## Histórico — fase 2, provisionamento compatível (publicado e encerrado)

A PR #43 foi mesclada em `8169177bcc32e158f9d53fb7f2f725d7ed4318a3`; [pipeline oficial](https://github.com/EwertonMendes/roteiva-web/actions/runs/39354281435) publicou `0007` com zero violações FK, três tabelas/dois índices/trigger e contagens anteriores/posteriores idênticas: uma conexão Drive, zero transações, jobs de exclusão e guards. Worker compatível versão `52e976a3-8306-41ca-a6e0-a12dd2a7be03` publicado com Cron preservado.

Decisão tomada: `0008_access_rollout.sql` fixa o marco no relógio D1 e o fim da cortesia em marco + 30 dias. A elegibilidade usa `createTime` do documento Firestore, não campo enviado pelo cliente. `INSERT OR IGNORE` com ID determinístico preserva trial e cortesia mesmo após retries. Cron processa um perfil por minuto, com cursor durável; falhas não avançam cursor nem marcam conclusão. Após completar o inventário inicial, não varre continuamente usuários.

**Configuração transitória histórica (já desativada em DEV):** `ACCESS_PROVISION_ON_DRIVE=true` permitia somente provisionamento sob demanda pelo mesmo caminho verificado antes de autorizar Drive/OAuth; não permite acesso sem perfil, suspenso, expirado ou em exclusão. Ausente/false nega usuários não provisionados. A compatibilidade foi **encerrada pela PR #48**, que publicou `ACCESS_PROVISION_ON_DRIVE=false`. Leitura de status permanece fora da checagem comercial; por decisão de 20/10/2026, novos pedidos de exclusão exigem acesso ativo.

A preparação de regras nessa fase só permitia GET privado de `access/current`, sem escrita/listagem e sem mudar a autorização de negócio. **As regras restritivas foram publicadas posteriormente pela PR #48**. PATCH da projeção usa precondição de versão/criação, resolve D1 após ler a versão e falha sem sucesso em conflito. Repetir estado igual não escreve novamente.

**Limite distribuído:** D1 e Firestore não têm transação conjunta. Nenhuma operação ADM existe aqui. O protocolo obrigatório com `sync_pending` está descrito na fase final abaixo; negação Firestore isolada antes de alterar D1 é insuficiente contra provisionamento concorrente. Uma falha não pode ser declarada concluída nem revertida para concessão. Não editar concessões manualmente em D1 e presumir revogação imediata no Firestore. Testes de suspensão devem usar exclusivamente fixtures e confirmar ambos os sistemas; não usar CI como prova de homologação remota.

Auditoria GitHub: `cloudflare-development` permite somente branch master; segredo Cloudflare já existe. `firebase-development` não possui gate de branch/reviewer configurado; os workflows atuais restringem deploy a master e SHA atual. Não foi alterada nenhuma proteção. Consulta à proteção clássica de master respondeu 404, sem afirmar inexistência de outros rulesets.

## Fase 3 — frontend integrado

A UI só monta o workspace após POST autenticado em `/access/ensure` e confirmação do status vindo do servidor Firestore; dados privados persistidos no browser não substituem essa confirmação. O relógio local orienta apenas a apresentação; Worker e regras decidem pelo horário do servidor. Estados expirado/suspenso ou falha mantêm somente saída/troca de conta e nova verificação; não exibem exclusão. A exclusão fica somente em Configurações com acesso ativo. Cadastro informa sete dias sem cartão/cobrança automática.

O deploy do frontend exige health com header de versão do controle e rota de provisionamento retornando 401 sem identidade antes de autenticar/publicar Hosting. Esse gate evita publicar a UI antes do Worker, mas não substitui smoke autenticado nem homologação. **As regras comerciais restritivas já foram publicadas no DEV pela PR #48**, após inventário completo. A demo local permanece sem autenticação/controle comercial.
### Causa confirmada da falha — runtime Cloudflare

Reproduzido com workerd/Miniflare da versão instalada: Request com `redirect:error` lança TypeError antes de acessar a rede; Workers aceita somente follow/manual. Essa opção foi introduzida no endurecimento dos fetches administrativos da fase 2. Corrigido para `manual` em leitura de perfil, projeção e enumeração/PATCH: redirecionamentos não são seguidos e status inesperado continua falhando fechado. Nenhuma alteração de credencial/IAM é necessária. Mocks Node agora exigem manual. A recuperação remota foi confirmada após deploy: três projeções e listagem Drive da conta existente, conforme estado no início deste documento. Referência: [Request Workers](https://developers.cloudflare.com/workers/runtime-apis/request/).
## Histórico: falha encontrada na homologação da fase 2 (resolvida na PR #46)

Durante a fase 2, o Worker foi publicado pelo run 39355067084 e as regras preparatórias pelo 39355067202; antes de liberar UI/regras restritivas, a leitura real da Biblioteca falhou e o inventário ainda não tinha projeções. Não considerar CI como homologação. Correção de diagnóstico acrescenta somente evento/código/status categóricos, sem UID, URL, exception ou resposta de provedor. Naquele momento, frontend e regras restritivas foram retidos até resolver a dependência. A UI foi publicada após a recuperação; **a PR #48 passou pelo gate e publicou as regras finais**.

QA frontend desta fase: regressão inicial teve 53 aprovados, três skips por viewport e dois casos de Agenda com fixture UTC diferente da data civil do browser. Corrigida exclusivamente a data do teste; repetição focada desktop/mobile aprovou ambos (2/2). Resultado combinado: 55 cenários aprovados, e a suíte completa foi posteriormente repetida com as regras finais (55 aprovados). Isso não valida Google/Drive remoto.

## Fase final — enforcement (publicado)

As regras finais exigem projeção com ownerUid do caminho, schemaVersion 1, suspensão falsa e prazo superior a request.time (ou concessão ilimitada). Ausência/corrupção nega operações de negócio. Status próprio e perfil permanecem legíveis; novos pedidos de exclusão seguem endpoint autenticado com acesso comercial ativo; o status e a continuidade de jobs já aceitos não dependem do prazo comercial. O cliente nunca escreve benefícios.

A flag `ACCESS_PROVISION_ON_DRIVE=false` está publicada em DEV: somente contas provisionadas podem usar Drive/OAuth. **A PR #48 já foi mesclada**, após comprovar os três perfis existentes provisionados, backfill completo, frontend integrado e homologação não destrutiva da conta existente. Esses eram os gates antes do merge, não pendências atuais de publicação. Regras antigas não devem ser restauradas como rollback comercial; corrigir o estado/reverter somente código compatível, mantendo negações.

### Protocolo obrigatório para alterações privilegiadas futuras

`0009_access_sync_fence.sql` adiciona sync_pending (0/1) a access_accounts. Nenhuma rota de usuário pode alterá-lo. Não é uma função ADM: é uma fence de integridade para que o futuro aplicativo separado coordene D1/Firestore. Enquanto 1, ensure e Drive falham fechado, sem republicar benefícios antigos.

A ordem segura substitui qualquer orientação simplificada de deny-first: (1) adquirir a fence D1 para o UID; (2) publicar negação no Firestore com precondição de versão, repetindo em conflito; (3) alterar os benefícios D1 enquanto a fence permanece; (4) publicar e verificar a projeção correspondente ao novo estado, com precondição; (5) liberar a fence somente após confirmar ambos. Falha preserva fence/negação e exige reconciliação; nunca declarar sucesso parcial. Isso impede ensure concorrente de desfazer a negação entre os dois sistemas. Não apagar grants históricos para revogar: preencher revoked_at, preservando o ID determinístico e trial.

Homologação automatizada final: 30 Rules + 55 Playwright passaram integralmente (três skips esperados). D1 remoto confirmou três contas/três cortesias, durações exatas e backfill completed_at preenchido; Firestore confirmou três projeções válidas e contagens de negócio inalteradas. A UI foi publicada pela PR #47; o smoke de cadastro/login descartável foi concluído, conforme o início. **A publicação final foi concluída**; suspensão e reativação por cortesia foram confirmadas remotamente conforme evidências abaixo. Permanecem sem aceite remoto: expiração efetiva, isolamento entre duas contas descartáveis e término verificável da exclusão.
Recuperação real após PR #46: a conta existente recebeu projeção de cortesia e a Biblioteca voltou a listar quatro arquivos de uma pasta já vinculada, sem reconectar Drive ou alterar arquivos. A cobertura inicial terminou nos três perfis. A cortesia termina em `2026-11-19T01:44:48Z` para essa coorte, sem renovação em retries. A comparação usa contagens agregadas, não hashes integrais dos dados privados.

### Evidência final de publicação e QA

Pipeline API 39358435356 aplicou 0009 com zero violações FK e contagens operacionais preservadas, publicou ACCESS_PROVISION_ON_DRIVE=false e Worker `f88428b4-3458-4c76-80fb-e808341b728d`. Regras finais publicadas pelo run 39358435474. A publicação final sucedeu o smoke de cadastro/login; os gates anteriores neste documento descrevem essa sequência operacional.

Fixture autorizada: trial de `2026-10-20T02:13:07.386Z` até `2026-10-27T02:13:07.386Z` (26/10 às 23:13 em São Paulo), 604.800.000 ms e zero concessões beta. Recarga e segundo login preservaram prazo e updateTime. Projeto criado pela UI permaneceu salvo após suspensão/reativação e recarga. Só a fixture recebeu mutações: fence adquirida/verificada, negação/projeção com CAS, ledger alterado, correspondência verificada e fence liberada. Cortesia de QA até `2026-10-28T02:13:07.386Z`, trial original intacto. Nenhum endpoint ADM.

**Histórico da exclusão descartável:** uma tentativa com `auth_time` superior a cinco minutos foi recusada corretamente, e a confirmação Google automática não retornou ao aplicativo. Após autenticação manual recente, **o pedido foi aceito**; a última observação reportou a saga em `revoking`, sem evidência de conclusão. Não afirmar que a conta foi excluída até confirmar a ausência dos documentos e da identidade. Expiração e isolamento A/B remotos continuam pendentes.

Medição após enforcement (19/10 às 23:27–23:31 em São Paulo): billing Firebase desabilitado; read_ops_count 359 e write_ops_count 14 nas 24h anteriores (métrica legada write_count 15, sujeita a atraso). Console Worker: aproximadamente 1,62 mil invocações/24h, 121 subrequests e zero erros de runtime reportados; versão f88428b4 com 100% do tráfego e 27 invocações no instante observado. Invocações incluem Cron; não equivalem à contagem de requisições HTTP faturáveis. Não é previsão de consumo em escala.

Regressão oficial da master publicada: [QA 39358964120](https://github.com/EwertonMendes/roteiva-web/actions/runs/39358964120), commit b0ae124, concluída com sucesso: 30 testes Rules e 55 Playwright desktop/mobile, três skips previstos. Evidência automatizada distinta da homologação Google/Drive real.
