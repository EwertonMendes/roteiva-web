# Prompt de provisionamento para Codex — Exclusão definitiva Roteiva DEV

> Execute este trabalho **apenas** com a autenticação administrativa que você já tem
> autorizada no Google Cloud/Firebase, Cloudflare e GitHub. **Nunca compartilhe
> credenciais, chaves JSON, JWTs, tokens ou payloads secretos no chat, no repositório
> ou em logs**. Não invente êxitos; quando não houver acesso a uma console ou CLI,
> informe o impedimento e a ação humana exata necessária.

Você é um engenheiro de plataforma/segurança Sênior. Conclua o provisionamento
e a homologação da exclusão definitiva de contas do Roteiva, mantendo a lógica
**igual à prevista para PROD** e usando **somente o DEV** nesta rodada.

## Ambiente e código

- GitHub: `EwertonMendes/roteiva-web`, PR **#30**,
  branch `feat/secure-account-deletion`. Rever o HEAD atual, executar CI e
  corrigir problemas reais na própria PR. Não copiar scripts de versões antigas.
- Firebase Auth/Firestore: projeto **`roteiva-web-dev`**.
- Cloudflare Worker: **`roteiva-api-dev`**, ambiente Wrangler `dev`.
- D1: binding **`DB`**, database **`roteiva-drive-dev`**.
- UI Firebase Hosting: `https://roteiva-web-dev.web.app/`.
- Documentação: `docs/ACCOUNT-DELETION.md`, arquitetura e roadmap.
- A branch define `ACCOUNT_DELETION_ENABLED=true`; o backend continua
  **fail-closed** se `FIREBASE_ADMIN_CREDENTIALS_JSON` não estiver válido.
  Não desabilitar verificações para “fazer funcionar”.

## Execução obrigatória

1. **Auditoria técnica antes de dar permissões.** Confirme na documentação
   atual do Google os contratos oficiais de `projects.accounts:delete`
   (Identity Toolkit Admin REST), Firestore `documents.patch`,
   `documents.list`, `documents.delete` e `:listCollectionIds` e o fluxo
   JWT OAuth 2.0 para service account. Verifique APIs ativadas no projeto DEV
   e crie um smoke test da credencial com permissões efetivas, sem usar conta
   de usuário real. Se os contratos, métodos HTTP, roles ou scopes divergirem
   do código da PR, **corrija-os com testes antes de habilitar**.
2. **IAM mínimo.** Crie ou reutilize uma service account dedicada só à
   exclusão no projeto `roteiva-web-dev` (nome descritivo, sem Owner/Editor).
   Conceda estritamente o conjunto necessário para listar/criar/atualizar/
   apagar documentos Firestore sob a aplicação e apagar identidades Firebase
   Auth. Valide as permissões efetivas, incl. `firebaseauth.users.delete`,
   sem alterar papéis da conta de deploy/conta de usuário. Se custom IAM não
   suportar granularidade no recurso, registre claramente essa limitação.
3. **Credencial protegida no Worker.** Configure o segredo
   `FIREBASE_ADMIN_CREDENTIALS_JSON` diretamente no ambiente Cloudflare
   `dev`, apontando ao **mesmo** `project_id=roteiva-web-dev`.
   Prefira federação/keyless se disponível sem comprometer o contrato da API;
   se utilizar chave JSON, gere-a **somente em ambiente administrativo
   seguro**, instale como secret `wrangler secret put ... --env dev`
   usando stdin protegido (não a coloque como argumento, env de CI ou arquivo
   versionado), restrinja o acesso e estabeleça rotação. Se a organização
   proibir criação de chaves, **não burle a política**; adapte o emissor de
   tokens para uma solução de identidade federada segura e documente.
   Não imprima material secreto nem mesmo mascarado.
4. **D1 e agendamento.** Verifique migrações `0004_account_deletion.sql`
   e `0005_deletion_fences.sql` no Worker DEV. Execute migrações remotas
   pelo workflow autorizado, sem SQL ad hoc destrutivo e sem alterar tabelas
   de outros usuários. Confira Cron `* * * * *` e alerta de
   `account_deletion_manual_review_pending`. Revise quotas/limites de
   tempo do Worker e a capacidade de progredir por lotes para milhares
   de documentos. Deixe um procedimento claro de tratamento e retomada de
   `manual_review`, só após corrigir a causa; nunca reinicie todos os
   usuários com um UPDATE em massa.
5. **CI e deploy protegido.** Rode `npm run typecheck`, `npm test`,
   `npm run build` no subprojeto `api/` e o CI completo do frontend
   (Firestore Rules Emulator, Playwright desktop/mobile, build Firebase e
   Pages). Faça review de segurança. Com todos os checks verdes e a identidade
   administrativa testada, conclua PR #30 e use o pipeline existente
   `master` → migrações D1 → deploy Worker DEV/Hosting DEV. Nunca publique
   em PROD, nem copie chaves/segredos DEV para PROD.
6. **Homologação destrutiva legítima.** Crie/use uma conta **exclusivamente
   descartável**, que tenha sido preparada para este teste (não apague a conta
   principal nem qualquer usuário preexistente sem autorização individual).
   Cadastre clientes/projetos, subcoleções e itens Drive de teste; execute
   a confirmação real `EXCLUIR MINHA CONTA` + reautenticação recente no
   navegador. Verifique: D1 `completed`; ausência de `users/{uid}` e
   subcoleções; identidade Firebase removida; tokens/conexões e transações
   OAuth ausentes; Drive original intacto; outro UID preservado; outra aba
   impedida de gravar. Teste falha temporária de Google/Firestore, retomada,
   repetição/idempotência, conta sem cadastro concluído, grandes volumes,
   browser mobile e desktop.
7. **Validação visual e comunicação.** Em `/configuracoes`, confirme que o
   botão abre o modal acessível, exige a frase exata e checkbox, que a
   reautenticação Google acontece só ao confirmar e que o login apresenta
   aviso de solicitação recebida, **sem alegar exclusão concluída antes do
   servidor**. Verifique tema claro/escuro, mobile e foco de teclado.
8. **Evidência e entrega.** Atualize `docs/ACCOUNT-DELETION.md`,
   `docs/ARCHITECTURE.md` e `docs/MVP-ROADMAP.md` com estado
   realmente verificado, links dos runs CI e URL de DEV. Entregue relatório
   conciso: IAM aplicado (sem credenciais), APIs habilitadas, migrations,
   Cron/alerta, teste com UID descartável (sem identificar a conta),
   observabilidade, bugs corrigidos, links de PR/deploy e pendências reais.
   Não reivindique sucesso sem verificação concreta.

## Regras inegociáveis

- A conta Roteiva e seus dados internos são eliminados permanentemente.
  **Nunca excluir arquivos originais do Google Drive**.
- Nunca usar credenciais privilegiadas no React, Firebase client, GitHub
  Actions logs ou D1. O frontend somente solicita a operação.
- Operações ficam isoladas pelo UID extraído do token Firebase validado e
  `auth_time` recente; nenhum UID de requisição deve direcionar a limpeza.
- Em falha, garantir processo retomável e etapa identificada; sem sucesso
  prematuro nem apagar Firebase Auth antes das coleções e vínculos.
- Não desabilitar Firestore Rules, CORS, autenticação, checagem de origem,
  rate limits ou IAM para passar no teste.
- Se algum recurso externo não estiver acessível, **pare e peça exatamente
  a autorização necessária**, entregando a PR com código validado e
  descrevendo o próximo passo. Não peça que o usuário cole chaves no chat.
