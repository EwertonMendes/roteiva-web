# Trial único por identidade Google

## Contrato e implementação

**IMPLEMENTADO na PR #51; publicação e homologação DEV ainda pendentes.** Sete dias por identidade elegível, sem renovação automática. A cortesia beta usa o marco fixo de 30 dias já existente; esta alteração não desloca seu prazo. Nenhum endpoint administrativo ou checkout é acrescentado.

O Worker verifica assinatura RS256, issuer, audience, expiração, emissão e autenticação do ID token Firebase. Exige Google como provedor, um único subject Google e e-mail verificado. Nome/e-mail do perfil e corpo da requisição não autorizam benefícios. Tokens forjados e claims inconsistentes falham fechados. Gmail pessoal normaliza caixa, pontos, +tags e googlemail.com; domínios corporativos/terceiros preservam pontos e +tags.

HMAC-SHA256 usa domínios separados para e-mail, Google subject e UID. A ledger não contém e-mail, nome, Google subject ou UID legível, nem FK para dados apagáveis. O índice primário permite consultas pontuais; não há scans de usuários nem consultas Firestore adicionais no navegador.

A migration **0010** permanece intacta. A **0011**, aditiva, fixa um verificador da chave. A fence SQL da migration 0008 já impede provisionamento depois do início da exclusão e é preservada. Uma única transação D1 (`batch`) registra todos os identificadores e lê a decisão. O primeiro titular nunca é alterado. Identificadores novos de um cadastro recusado herdam um titular conflitante; a decisão também fica presa ao HMAC do UID, impedindo retry elegível com outro e-mail após uma falha intermediária. Falha SQL reverte o lote inteiro. Chave diferente da registrada bloqueia novas decisões sem inserir marcadores.

A projeção Firestore é publicada por `documents:commit`: atualização idêntica de `ownerUid` no perfil com precondição do `updateTime` lido e escrita condicional da projeção, atomicamente. Não altera campos de negócio, revisão ou datas do perfil. Bloqueio/remoção concorrente do perfil faz o commit falhar; uma projeção não pode ser recriada como órfã por um provisionador atrasado. Retry conserva as datas imutáveis do D1.

A exclusão exige registrar o principal verificado antes de aceitar o job. Cada fase da saga verifica o marcador do UID e a chave. Jobs iniciados antes do rollout sem marcador pausam com `trial_identity_retention_required`, preservando Auth e os dados restantes. O usuário deve autenticar novamente e repetir a solicitação assinada; o operador retoma o mesmo job conforme [ACCOUNT-DELETION.md](ACCOUNT-DELETION.md), sem fabricar claims nem apagar a ledger. Falhas chegam ao fluxo existente de revisão após dez tentativas. Outras contas continuam independentes.

## Privacidade e retenção

**Decisão técnica para DEV:** reter os HMACs após exclusão enquanto o Roteiva oferecer o benefício de teste único, estritamente para impedir sua reutilização. Não há prazo automático curto: apagar o marcador restauraria a elegibilidade indevidamente. Não usar para publicidade, perfis comportamentais ou análise de clientes. Revisar a necessidade pelo menos anualmente e quando a oferta terminar; nessa ocasião, definir eliminação segura e efeitos sobre recuperação do banco. O tombstone operacional da exclusão continua com 24 horas; é separado da ledger antifraude.

O aviso de cadastro informa finalidade, persistência após exclusão e natureza pseudonimizada. Os HMACs **não são anônimos**. O controlador deve documentar base legal, necessidade/proporcionalidade, avaliação de legítimo interesse se aplicável, canal para direitos/contestação e responsabilidades antes de abertura pública/PROD. O aceite genérico de cadastro não substitui essa avaliação. Uma solicitação legal de eliminação exige avaliação humana fora do produto; não prometer eliminação irrestrita nem declarar conformidade LGPD. A revisão técnica segue os princípios de finalidade, necessidade e transparência e as regras de término/conservação da [LGPD, arts. 6, 7, 10, 15, 16 e 18](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm). Não existe parecer jurídico nesta entrega.

Limite histórico: exclusões concluídas antes de existir marcador não podem ser identificadas retroativamente sem uma fonte legítima. Um e-mail corporativo reassociado a outra pessoa pode gerar recusa conservadora do benefício; isso não suspende a identidade nem invalida assinatura/cortesia existente. Acesso comercial futuro depende do processo comercial separado, sem interface ADM no Roteiva.

## Segredo e recuperação

`TRIAL_IDENTITY_HMAC_KEY` é exclusivo do Worker `roteiva-api-dev`, ambiente `dev`: 32 bytes aleatórios codificados em base64url, 43 caracteres. Nunca em `vars`, Vite, GitHub, logs, comentários ou exemplos com valor real. Não reutilizar outras chaves. O pipeline verifica somente nome/tipo antes de qualquer migration ou publicação.

Wrangler travado: **4.151.1**. `secret list --env dev --format json` é suportado. O handler de `secret put` envia exclusivamente nome/tipo/valor à API `/workers/scripts/roteiva-api-dev/secrets`; não compila nem publica o código deste checkout. Só usar após confirmar que o Worker existente é DEV; se não existir, interromper em vez de criar um Worker rascunho. Não usar `versions secret put` como se já ativasse o segredo.

A geração e o envio devem ocorrer em um processo com stdin direto ao Wrangler, sem imprimir nem persistir o valor. Desabilitar logs de arquivo e métricas. Verificar novamente nome/tipo após o sucesso. O secret é ilegível pela API depois de instalado.

**Recuperação:** não substituir a chave para tentar corrigir uma indisponibilidade. Primeiro verificar binding, ambiente e a última versão funcional. Uma versão anterior que preserva o mesmo secret pode permitir recuperação operacional; não suponha que rollback recuperará um valor perdido. Se houver cópia sob custódia segura do controlador, restaurar exatamente a mesma chave pelo canal de secret e verificar contra o verificador D1. Esta entrega não cria cópia legível em disco nem envia a chave para outro serviço.

**Perda definitiva:** como a ledger não contém identidades originais, não é possível re-HMAC dos titulares apagados. Sem chave original ou política de migração que conserve comparações antigas, manter novos trials fechados; não limpar o verificador/ledger. Recuperação comercial de assinaturas/cortesias exige preservar os registros existentes e processo específico, nunca conceder novo trial por falha.

**Rotação planejada:** exige projeto separado com múltiplas versões, consulta a todos os HMACs históricos e reconciliação atômica das identidades verificadas disponíveis. Manter a chave antiga para reconhecer titulares já apagados. Se comprometida, tratar como incidente, avaliar risco de correlação e exposição e decidir migração/retirada da oferta com o controlador. Nunca trocar apenas o secret nem remover o verificador para destravar o sistema. O guard atual rejeita a troca acidental.

## Rollout e evidências

1. Auditoria, testes, informação ao usuário e decisão de retenção.
2. Secret DEV instalado e verificado; D1: contagens, esquema, integridade, migrations pendentes e ponto Time Travel quando disponível.
3. CI na versão exata da PR; merge somente com pré-requisitos cumpridos. Migrations 0010/0011 e Worker exclusivamente pelo workflow oficial API DEV. Hosting pelo workflow frontend; nenhuma publicação PROD.
4. Smoke health, identidade inválida e Hosting. Homologação com Google descartável autorizado: primeiro cadastro, mesmo prazo após login/F5, exclusão, recadastro com UID novo recusado, outra identidade elegível; preservar contas reais.

A garantia transacional de `batch` é documentada pela [Cloudflare](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). O script de auditoria do pipeline verifica as migrations, tabelas/triggers/índices, `quick_check`, `foreign_key_check` e contagens. O mecanismo oficial de migrations registra execução; uma segunda execução não reaplica os arquivos. Não usar DROP TABLE, restauração integral ou limpar dados.

Testes API usam SQLite real, RSA/JWT e WebCrypto; dependências Google/Firestore simuladas são explicitadas. `trial-d1-runtime.test.mjs` executa a função de elegibilidade com o binding D1 real do Miniflare/workerd em banco descartável: concorrência, rollback, constraints e retenção. Isso não prova um Worker publicado. Playwright desktop/mobile com Firebase Emulators verifica interface/regras; seu endpoint Worker é simulado. A homologação Google/Worker DEV é uma evidência distinta e só será marcada após execução real.

**Rollback:** conservar ledger, verificador e secret. Voltar a um Worker sem HMAC reabre a brecha; preferir correção progressiva ou interromper provisionamento. Não relaxar regras Firestore.


### Evidências da revisão (20/10/2026, antes do merge)

- API: 98/98 testes aprovados, incluindo integração D1/workerd; TypeScript, migrations locais e bundle dry-run aprovados.
- Frontend: TypeScript, agenda/financeiro e 27/27 testes Node aprovados; builds Firebase/demo/emulator aprovados.
- Emuladores/Playwright: 30/30 testes Rules e 55 browser aprovados, três skips preexistentes. A suíte será repetida no HEAD final.
- Saga integrada: backend real com D1/workerd e Firebase Auth/Firestore emulados passou; criação de conta, datas imutáveis, falha/retomada da exclusão, Auth/perfil/projeção ausentes, UID novo recusado, controle independente ativo e commit concorrente bloqueado. Assinante Google e troca de token sintéticos, sem alegação de OAuth real.
- Cloudflare DEV: secret instalado em 20/10, nome/tipo conferidos e conteúdo publicado comparado antes/depois, idêntico. Nenhum valor persistido em arquivo, log ou GitHub.
- D1 remoto antes do rollout: migrations 0001–0009, nenhuma exclusão pendente, nenhum objeto trial_identity, zero violações de FK. Bookmark Time Travel registrado na evidência operacional local antes das alterações. 0010 e 0011 ainda não aplicadas remotamente.
- CI final, deploy oficial e teste Google/Worker DEV continuam pendentes até confirmação por evidência.
