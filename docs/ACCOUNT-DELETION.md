# Exclusão permanente de conta — arquitetura e ativação segura

**Estado (18/10/2026):** implementação na PR #30; conta administrativa DEV provisionada e smoke administrativo real validado. Publicação e homologação Google/Drive pela interface ainda pendentes; não confundir o smoke com aceite completo.

O processo de exclusão é definitivo, sem prazo de recuperação. A aplicação informa claramente quando a solicitação foi aceita, sem afirmar que a limpeza já foi concluída. O modal exige a
frase exata `EXCLUIR MINHA CONTA`, confirmação explícita e reautenticação
Google via Firebase. O backend valida a frase e `auth_time` ≤ 300 segundos;
a palavra, isoladamente, nunca autoriza uma exclusão.

## Infraestrutura e limites de confiança

- `POST /account/deletion`: determina o UID pelo Firebase ID token assinado,
  testa credenciais administrativas, registra operação com UID único no D1,
  tenta bloquear o documento `users/{uid}` no Firestore e responde HTTP 202
  após persistir o pedido. Se o bloqueio falhar, o estado `locking` é
  retomado pelo Cron e nunca é confundido com exclusão concluída.
- `GET /account/deletion/status`: devolve disponibilidade e situação;
  não retorna tokens, nomes de arquivos ou dados privados.
- Cloudflare Cron executa `runPendingDeletions` uma vez por minuto; cada
  etapa é retomável, com leases no D1 e incremento de tentativas.
- `account_deletions` é armazenamento operacional mínimo, sem email ou
  credencial OAuth. Concluídos mantêm marcador por 24h para idempotência
  e bloqueio das sessões Firebase ainda não expiradas.
- `ACCOUNT_DELETION_ENABLED=true` liga a rota no ambiente DEV, mas a execução
  continua indisponível enquanto não existir uma credencial administrativa válida. O Worker precisa do segredo
  `FIREBASE_ADMIN_CREDENTIALS_JSON`, **nunca** `VITE_*` ou um arquivo
  versionado. Não adicionar a chave privada a GitHub, D1, logs ou docs.

A service account exclusiva para DEV deve ser criada no Google Cloud IAM e
receber apenas permissões para listar/apagar documentos Firestore, editar o
marcador de exclusão e excluir usuários Firebase Authentication. Verificar
concretamente `firebaseauth.users.delete`, acesso Firestore via IAM e
permissão de emissão de OAuth token; não usar Owner/Editor no projeto inteiro.
Criar credencial específica com rotação/monitoramento e instalá-la como segredo
Cloudflare **após** teste de IAM com conta descartável.

**Atenção:** APIs REST de servidor ignoram Firestore Security Rules. Toda
autorização e escopo do caminho deve permanecer no servidor. `uid` vem apenas
do token assinado. A conta de serviço deve apontar exclusivamente para
`roteiva-web-dev`. Para novo ambiente, criar configuração/credencial separada.

## Etapas da execução

1. `locking`: registra `deletionState: "deleting"` (ou documento marcador
   para conta sem cadastro). Regras negam leituras de subcoleções e gravações do cliente; o perfil continua consultável apenas pelo proprietário para mostrar
   "Exclusão em andamento". Se o bloqueio falhar, mantém job agendado.
2. `revoking`: invalida cache/tokens Drive em D1, tenta revogar os tokens
   Google e remove conexões + OAuth pendentes sem apagar arquivos originais
   da conta Google. Triggers D1 impedem novas concessões após a solicitação.
3. `firestore`: percorre **todas** as subcoleções sob `users/{uid}`, em
   lotes pequenos, removendo filhos antes de seus pais; reinspeciona a árvore
   a cada execução. Preserva o marcador raiz para bloquear sessões antigas.
4. `identity`: elimina a identidade Firebase via Identity Toolkit Admin
   usando `firebaseauth.users.delete`; repetição de `USER_NOT_FOUND`
   é tratada como idempotente. Só depois apaga o marcador raiz.
5. `completed`: registra conclusão mínima; operações com JWT residual são
   bloqueadas enquanto o tombstone existir. O usuário não pode desfazer.

Backoff exponencial limita tentativas. Após 10 falhas repetidas a operação fica
em `manual_review` e **não** é declarada concluída. Configurar alertas
operacionais para qualquer `manual_review`; o operador precisa investigar e
retomar com cuidado. Logs não devem incluir UID, tokens, perfil ou arquivos.

## Homologação necessária antes de habilitar

- CI: TypeScript/frontend, Worker/D1, Firebase Rules e Playwright desktop/mobile.
- Emuladores: isolamento A/B, usuários com/sem cadastro, diferentes volumes,
  falha entre etapas, controle de lease, repetição sem duplicação, concorrência.
- IAM DEV: conta descartável exclusiva, credencial administrativa com escopo
  mínimo; revogação Drive simulada e real quando houver autorização explícita;
  conferir documentos ausentes e identidade Firebase removida.
- Configurar telemetria/alerta para `manual_review`, relatórios de jobs
  parados, política de retenção, limites Cloudflare e rotação do segredo.
- **Não usar usuários preexistentes como teste**; flag DEV requer credencial validada e CI verde.
- Validar que JSON exportado pelo navegador inclui somente dados carregados;
  não anunciar exportação integral sem endpoint específico.

## Observações de privacidade

Arquivos externos existentes no Google Drive nunca são apagados. Uma revogação
OAuth pode afetar outras autorizações concedidas ao mesmo projeto Google.
A limpeza de cache local tenta remover dados do dispositivo corrente, mas não
é possível apagar de forma garantida arquivos já exportados ou o cache offline
de outros dispositivos. A retenção de backups e logs precisa seguir política
documentada, com limitações legais aplicáveis.

O executor administrativo utiliza `FIREBASE_PROJECT_ID` como fonte dos caminhos REST, validando que o `project_id` da credencial instalada coincide exatamente. A lógica é compartilhável com PROD futuramente, mas o gateway Worker atual continua DEV-only; uma futura implantação PROD exigirá infraestrutura, segredos, IAM e validação específicos, sem redirecionar a conta de serviço DEV.

## Provisionamento verificado em 18/10/2026

- Projeto único: `roteiva-web-dev`; Firestore `(default)`, Standard/nativo, `southamerica-east1`. APIs Firestore e Identity Toolkit habilitadas.
- Service account: `account-deletion-dev@roteiva-web-dev.iam.gserviceaccount.com`.
- Papel customizado único: `projects/roteiva-web-dev/roles/roteivaAccountDeletion`, com `datastore.entities.create`, `.get`, `.list`, `.update`, `.delete` e `firebaseauth.users.delete`. Sem papéis básicos ou de administração IAM/deploy. IAM de servidor não limita documentos por UID; o isolamento é obrigação do adaptador. Não conceder Owner/Editor, Firebase Admin ou Token Creator ao executor.
- Chave gerada em memória no ambiente administrativo, testada e transmitida por stdin para `wrangler secret put FIREBASE_ADMIN_CREDENTIALS_JSON --env dev`; logs em disco desativados na operação. Conferido o nome do segredo no Worker. Chaves de tentativas sem instalação foram revogadas. Nenhuma chave privada foi gravada em arquivo ou commit.
- Smoke real: duas identidades Firebase descartáveis novas, 71 documentos incluindo clientes, financeiro, 65 projetos, subcoleções e pai ausente; quatro lotes. Ausência dos documentos e da identidade A confirmada com credencial independente; B permaneceu intacta durante a verificação. Repetição de delete Auth aprovada. Leitura Auth pela conta de serviço negada com HTTP 400 `INSUFFICIENT_PERMISSION` (Google não usa 403 em todos os contratos). Fixtures descartáveis removidas ao encerrar.
- Este smoke usa APIs administrativas reais; **não valida** reautenticação Google no browser, Drive real, Cron remoto ou a saga HTTP/D1 publicada. Esses aceites continuam separados.

Rotação: no máximo a cada 30 dias (primeira revisão até 17/11/2026), ou imediatamente em suspeita. Gerar nova chave na mesma conta, repetir smoke, substituir somente o segredo DEV, verificar execução e revogar a chave anterior. Verificar metadados das chaves no IAM; nunca recuperar/imprimir o segredo para diagnosticar. Falhas de política administrativa não autorizam contorno por conta alternativa ou ampliação de papel.

## Correções de segurança e recuperação

`accountDeletionFences/{uid}` é marcador mínimo, administrativo e inacessível ao cliente. É gravado antes de bloquear o perfil e impede também a recriação de `users/{uid}` por JWT residual após a exclusão Auth. O perfil raiz continua sendo removido após Auth. Cron retém a fence e o tombstone D1 por pelo menos 24h após `completed`, acima da validade de uma hora dos ID tokens; remove a fence antes do tombstone e preserva o job se essa limpeza falhar. Não configurar TTL que remova a fence enquanto houver operação incompleta.

Limites por passo: um vínculo Drive por execução, até 20 exclusões Firestore e orçamento de 35 segundos/100 chamadas; lease de 120 segundos. Árvores usuais avançam por reinspeção e remoção das primeiras páginas, incluindo `showMissing=true`. Orçamento não permite avançar para Auth sem confirmar árvore vazia. Erro 404 de enumeração é falha de dependência, nunca prova de ausência. Limites de fanout/profundidade e árvores que não progridem exigem investigação operacional.

A migração aditiva `0006_deletion_recovery.sql` preserva `failed_phase`, bloqueia transações OAuth tardias e cria `oauth_exchange_guards`. Antes de trocar um código Google, o callback cria um guard durável; credenciais emitidas são guardadas criptografadas até persistência do vínculo. A exclusão espera esses guards e revoga o token retido antes de limpar vínculos. Interrupção na janela entre emissão remota e persistência deixa guard sem token: após dois minutos produz `oauth_exchange_unresolved` e, esgotadas as tentativas, requer revisão; **não** declara revogação nem conclusão. O operador precisa confirmar/revogar a concessão Google antes de remover somente esse guard. Guards de callbacks malsucedidos também precisam de reconciliação e não devem ser descartados por expiração automática.

## Operação e alerta

Logs de aplicação categóricos têm sampling 100%, com logs de invocação desativados. `account_deletion_manual_review_pending` contém apenas contagem. O workflow `Monitor account deletion DEV`, na `master`, consulta somente contagens D1 a cada 15 minutos e falha diante de revisão manual ou ausência de progresso por duas horas. GitHub pode atrasar schedules; a entrega de notificações depende das preferências de Actions dos responsáveis e precisa ser confirmada operacionalmente. O workflow não é prova de alerta entregue.

Para investigar, usar acesso administrativo DEV e consultar `operation_id, phase, failed_phase, error_code, attempts, updated_at, lease_until` de uma operação específica, sem copiar UID ou credenciais para logs/issues. Corrigir IAM/dependência/guard primeiro. Retomar somente o `operation_id` revisado com SQL parametrizado equivalente a:

```sql
UPDATE account_deletions
SET phase=failed_phase, failed_phase=NULL, attempts=0, error_code=NULL,
    next_attempt_at=?1, updated_at=?1, lease_id=NULL, lease_until=0
WHERE operation_id=?2 AND phase='manual_review'
  AND failed_phase IN ('locking','revoking','firestore','identity')
  AND lease_until<?1;
```

Exigir exatamente uma linha alterada, verificar o próximo Cron e a conclusão real. Não mudar manualmente para `identity`/`completed`, remover fences antecipadamente, excluir tokens sem revogar ou executar UPDATE em massa. Nenhuma retomada manual foi realizada nesta homologação.

Contratos oficiais conferidos: [Auth delete](https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/delete), [Firestore list](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list), [patch](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/patch), [delete](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/delete), [listCollectionIds](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/listCollectionIds), [IAM Firestore](https://cloud.google.com/firestore/native/docs/security/iam) e [JWT OAuth service account](https://developers.google.com/identity/protocols/oauth2/service-account).
