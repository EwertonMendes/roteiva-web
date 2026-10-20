# Controle de acesso SaaS — rollout DEV

## Estado em 19/10/2026

**PARCIAL:** primeira entrega contém somente a migração aditiva D1 `0007_access.sql`, testes SQLite e verificação no pipeline oficial API DEV. Não ativa bloqueios comerciais nem publica frontend ou Security Rules da PR #42. Aplicação remota e homologação serão registradas após o workflow concluir.

Decisão tomada pelo proprietário: contas DEV existentes recebem cortesia finita de **30 dias a partir da migração**, separada do teste único de sete dias. Novos cadastros recebem somente o teste. O provisionamento deve usar um marco de migração fixo e identificador determinístico da concessão; repetir não reinicia os prazos. Nenhuma tela ou endpoint ADM pertence ao Roteiva.

## Publicação em entregas compatíveis

1. Merge desta entrega de infraestrutura na master; `API DEV` aplica migrations com o ambiente `cloudflare-development` protegido. Conferir contagens anteriores/posteriores, esquema, índices, trigger e `foreign_key_check` antes de publicar o Worker compatível. Sem substituição de banco.
2. Entrega do Worker com provisionamento e compatibilidade temporária explicitamente limitada às contas anteriores ao marco; contas suspensas/expiradas já provisionadas nunca podem usar essa compatibilidade. Autenticação, propriedade, exclusão, Origin e rate limits continuam obrigatórios. Falhas de dependência negam operação.
3. Publicar frontend integrado pelo pipeline oficial após confirmar Worker pronto. Provisionar todas as contas anteriores ao marco de forma idempotente, sem tocar documentos de negócio; verificar D1 e projeções Firestore.
4. Encerrar compatibilidade do Worker somente após inventário sem lacunas e homologação real. Publicar regras restritivas em entrega separada, após essa verificação. Nunca incluir essas regras no merge inicial da PR #42.
5. Homologar cadastro, login repetido, cortesia, expiração, suspensão/reativação, isolamento A/B, Drive e exclusão exclusivamente de fixtures descartáveis. CI/emuladores não comprovam essas operações no DEV.

O código restante da PR #42 não está liberado para merge integral. Aprovação de ambiente/proteção precisa ser cumprida sem alteração de política. Somente master pode publicar.

## Infraestrutura auditada

Em 19/10/2026, a API Google confirmou a conta `account-deletion-dev@roteiva-web-dev.iam.gserviceaccount.com` ativa e exclusivamente vinculada ao papel `roteivaAccountDeletion`: `datastore.entities.create/get/list/update/delete` e `firebaseauth.users.delete`. Essas permissões bastam para ler perfil e criar/atualizar a projeção; não é necessário criar outra credencial ou ampliar IAM. IAM não limita esses documentos por UID: o backend deve fazê-lo.

Bindings reais do Worker confirmaram `FIREBASE_ADMIN_CREDENTIALS_JSON` como `secret_text`, `ACCOUNT_DELETION_ENABLED=true`, projeto DEV, DB e ambos rate limiters. Conteúdo do segredo não foi lido. Isso confirma presença/configuração, **não funcionamento efetivo** da chave instalada; um provisionamento descartável deve comprová-lo. Health Worker e Hosting responderam 200. Sessão Wrangler renovada; o token local não possui escopo D1 (403), portanto migração remota deve usar o pipeline autorizado existente, sem criar token duplicado.

Console Cloudflare: 89/100.000 requisições Worker no dia; D1 aproximadamente 7 mil linhas lidas, 3 escritas e 98,3 kB nas últimas 24h no instante consultado. São métricas anteriores ao rollout, não estimativas de consumo do controle novo. Regras comerciais acrescentarão leitura da projeção; medir no Console Firebase, considerando cache de chamadas de regras.

## Migração e reversão

`0007` somente cria três tabelas, dois índices e trigger. Trial dura exatamente 604.800.000 ms e datas/UID não podem mudar por UPDATE. Cortesia temporária exige fim não nulo e posterior ao início; concessões/assinaturas têm FK com cascata. Não remove nem altera tabelas OAuth/exclusão. Teste SQLite compara integralmente a conexão preexistente antes/depois e valida constraints/FK/cascata.

O pipeline registra apenas nomes de migrations/esquema e contagens, nunca UID, email ou tokens. Se contagens mudarem por atividade concorrente, interromper e investigar antes de publicar; igualdade de contagens não comprova igualdade de conteúdo sozinha. A natureza aditiva da migration e teste de preservação complementam essa evidência.

Rollback desta fase: retornar código Worker ao commit anterior pelo pipeline protegido, **manter `0007` e todos os dados**. Não executar DROP, não editar migration aplicada, não restaurar o D1 inteiro sobre gravações recentes. Antes de eventual recuperação de desastre, capturar um bookmark e avaliar o impacto de Time Travel com o proprietário. Rollback posterior não pode restaurar regras permissivas para contas suspensas: manter regras restritivas e corrigir infraestrutura/projeções.

Referências: [migrations D1](https://developers.cloudflare.com/d1/reference/migrations/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [limites Firestore](https://firebase.google.com/docs/firestore/quotas).

## Fase 2 — provisionamento compatível (em preparação)

A PR #43 foi mesclada em `8169177bcc32e158f9d53fb7f2f725d7ed4318a3`; [pipeline oficial](https://github.com/EwertonMendes/roteiva-web/actions/runs/39354281435) publicou `0007` com zero violações FK, três tabelas/dois índices/trigger e contagens anteriores/posteriores idênticas: uma conexão Drive, zero transações, jobs de exclusão e guards. Worker compatível versão `52e976a3-8306-41ca-a6e0-a12dd2a7be03` publicado com Cron preservado.

Decisão tomada: `0008_access_rollout.sql` fixa o marco no relógio D1 e o fim da cortesia em marco + 30 dias. A elegibilidade usa `createTime` do documento Firestore, não campo enviado pelo cliente. `INSERT OR IGNORE` com ID determinístico preserva trial e cortesia mesmo após retries. Cron processa um perfil por minuto, com cursor durável; falhas não avançam cursor nem marcam conclusão. Após completar o inventário inicial, não varre continuamente usuários.

`ACCESS_PROVISION_ON_DRIVE=true` permite somente provisionamento sob demanda pelo mesmo caminho verificado antes de autorizar Drive/OAuth; não permite acesso sem perfil, suspenso, expirado ou em exclusão. Ausente/false nega usuários não provisionados. Encerrar essa compatibilidade em entrega posterior após inventário e frontend confirmados. Exclusão de conta e leitura de status ficam fora da checagem comercial.

A preparação de regras nesta fase só permite GET privado de `access/current`, sem escrita/listagem e sem mudar a autorização de negócio. A publicação restritiva continua em entrega separada. PATCH da projeção usa precondição de versão/criação, resolve D1 após ler a versão e falha sem sucesso em conflito. Repetir estado igual não escreve novamente.

**Limite distribuído:** D1 e Firestore não têm transação conjunta. Nenhuma operação ADM existe aqui. A futura revogação/suspensão deve primeiro publicar negação no Firestore com precondição, depois alterar D1 e reconciliar; uma falha não pode ser declarada concluída nem revertida para concessão. Não editar concessões manualmente em D1 e presumir revogação imediata no Firestore. Testes de suspensão devem usar exclusivamente fixtures e confirmar ambos os sistemas. Antes de habilitar as regras finais, validar esse protocolo e concorrência; não usar CI como prova de homologação remota.

Auditoria GitHub: `cloudflare-development` permite somente branch master; segredo Cloudflare já existe. `firebase-development` não possui gate de branch/reviewer configurado; os workflows atuais restringem deploy a master e SHA atual. Não foi alterada nenhuma proteção. Consulta à proteção clássica de master respondeu 404, sem afirmar inexistência de outros rulesets.

## Fase 3 — frontend integrado

A UI só monta o workspace após POST autenticado em `/access/ensure` e confirmação do status vindo do servidor Firestore; dados privados persistidos no browser não substituem essa confirmação. O relógio local orienta apenas a apresentação; Worker e regras decidem pelo horário do servidor. Estados expirado/suspenso ou falha mantêm saída, nova verificação e exclusão da própria conta disponíveis. Cadastro informa sete dias sem cartão/cobrança automática.

O deploy do frontend exige health com header de versão do controle e rota de provisionamento retornando 401 sem identidade antes de autenticar/publicar Hosting. Esse gate evita publicar a UI antes do Worker, mas não substitui smoke autenticado nem homologação. Regras comerciais restritivas continuam em entrega posterior ao inventário completo. A demo local permanece sem autenticação/controle comercial.
