# Exclusão permanente de conta — arquitetura e ativação segura

**Estado:** implementação candidata na PR #30; pronta para ativação no DEV após provisionar a credencial administrativa e concluir homologação.

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
- **Não usar usuários reais como teste**, nem ligar flag no PR/deploy.
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
