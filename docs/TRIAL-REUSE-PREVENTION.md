# Trial único por identidade Google — proteção contra recriação de conta

## A brecha corrigida

Antes desta alteração, access_accounts era indexado somente pelo UID Firebase e era apagado por eraseAccess ao excluir uma conta. Um novo cadastro com o mesmo Google criava novo UID e novo trial de sete dias. O bloqueio da mesma conta não cobria esse cenário.

A migration **0010_trial_identity_claims.sql** introduz uma ledger separada sem FK nem informação legível de cliente. Identificadores da conta Google (sub do provedor), do e-mail verificado e do UID da instância são transformados via **HMAC-SHA256 com chave exclusiva do Worker**. Nenhum e-mail, nome, UID ou Google sub em texto puro fica armazenado na ledger, e o proprietário do primeiro trial é imutável. Esses marcadores permanecem quando o espaço, a identidade Firebase e os registros comerciais por UID são apagados.

- O mesmo Google/mesmo e-mail verificado com novo UID pode criar cadastro e pedir suporte, mas recebe projeção **trial vencido**, sem reiniciar sete dias.
- O mesmo UID revalidado nunca reinicia prazo.
- O e-mail da UI/perfil Firestore não é fonte confiável. Os identificadores são extraídos exclusivamente de **ID token Firebase assinado**, com e-mail verificado e sign_in_provider Google.
- Gmail pessoal: normalizar googlemail.com, maiúsculas, pontos e +tags. **Não** aplicar a regra de pontos/+ a domínios Workspace/terceiros.
- O Worker verifica D1 e Firestore; horário do browser não autoriza direitos.
- Uma conta antiga que não acessou o app após a proteção ainda recebe seu marcador ao solicitar exclusão: a operação é recusada se não for possível gravar esse marcador.
- O servidor mantém somente um registro pseudonimizado de prevenção de abuso após exclusão. É um dado **pseudonimizado, não anonimizado**: informar o usuário e revisar fundamento, retenção e direitos LGPD antes de PROD. Solicitações legais de apagamento do marcador exigem processo seguro separado.

## Pré-requisito operacional crítico — segredo

A publicação depende do segredo exclusivo **TRIAL_IDENTITY_HMAC_KEY** no Worker **roteiva-api-dev**, no ambiente Cloudflare **dev**.

Gere **32 bytes criptograficamente aleatórios** e encode em base64url (43 caracteres sem padding). Configure como Worker Secret pela interface Cloudflare ou Wrangler autorizado, **sem usar** \`vars\`, sem commit, logs, screenshots ou mensagens. **Nunca reusar** TOKEN_KEYS, credenciais Firebase ou chave de assinatura.

Exemplo de comando para execução LOCAL autorizada (não cole o valor na conversa):

\`\`\`bash
cd api
node -e "process.stdout.write(Buffer.from(require('node:crypto').randomBytes(32)).toString('base64url'))" | npx wrangler secret put TRIAL_IDENTITY_HMAC_KEY --env dev
\`\`\`

Atenção: o segredo deve ser tratado como **persistente**. Trocar/perder o segredo sem reconciliação segura invalida comparações com marcadores antigos e poderia permitir novos trials. Planejar versionamento e migração antes de qualquer rotação.

O pipeline oficial executa \`api/scripts/check-trial-secret.mjs\` e **interrompe o deploy antes de migrar/publicar o Worker** se o segredo não existir; o valor não é lido. A aplicação também falha fechada em POST /access/ensure e solicitação de exclusão se o segredo faltar ou for inválido. Status/logout não dependem dele. O armazenamento é um acréscimo D1, não altera/toca os dados de negócio, login, calendários ou Google Drive.

## Rollout e rollback seguro

1. Revisar UX/informação de privacidade, base legal e política de retenção.
2. Provisionar o segredo em **DEV somente**, conferir via nome/tipo sem exibir o valor.
3. Aplicar migration 0010 e publicar Worker pelos pipelines oficiais, **após passar CI/QA**. Não publicar PROD.
4. Verificar com Google fixtures descartáveis: cadastro A, trial 7d, exclusão completa A, recadastro B com mesmo Google/e-mail, trial bloqueado; o login de outra pessoa C deve receber trial 7d. Não mexer nas três contas existentes.
5. Nunca apagar marcadores por conta da exclusão normal. Não usar o mesmo segredo em ambientes distintos.

**Limitação histórica:** contas que concluíram exclusão **antes** da implantação 0010 não têm identificador remanescente verificável. Sem dados antigos não é possível identificar essas pessoas retroativamente.

**Rollback:** não remover a tabela/claims nem reverter Firestore Rules para permissivas. Manter o segredo sob controle. Caso falhe, preservar o último Worker com HMAC e corrigir o defeito; retornar ao Worker anterior removeria a proteção e reabriria a brecha, portanto requer decisão explícita.

## Testes

\`npm test\` em \`api\`: prova no SQLite local a persistência pós-exclusão, UID novo com mesmo e-mail/Google, aliases Gmail, e-mail diferente do mesmo provedor, terceiros distintos, imutabilidade do esquema, ausência de PII em texto puro e rejeição de ID token inválido/sem email_verified. Não usar conta real.
