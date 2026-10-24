# Dropbox no Roteiva — implementação DEV-first

**Status: em desenvolvimento. Não é um relatório de aceitação nem autorização para publicar.**

## Requisito

Adicionar contas Dropbox ao fluxo de Biblioteca, projetos e revisões, com navegação, busca, previews (imagem, vídeo, áudio, PDF), miniaturas, upload retomável e progressivo, comentários por tempo, revisões versionadas, links de aprovação protegidos, expiração e revogação. O usuário escolhe provedor sem precisar aprender protocolos. Google Drive deve continuar funcionando exatamente como antes.

### Segurança / não requisitos

Nunca solicitar a senha do Dropbox. Tokens de acesso e refresh somente no Worker e cifrados em D1. Não criar compartilhamento direto por padrão nem usar URLs temporárias do Dropbox como URLs públicas de mídia. O visualizador não pode impedir, de modo absoluto, que um cliente com acesso copie os bytes. Não implementar exclusão de arquivos, sincronização bidirecional ou migração de arquivos Google -> Dropbox nesta entrega.

## Infra — o que o GitHub e as pipelines existentes permitem

1. Versionar migrations D1, novas tabelas de conexão/transactions/uploads e provider em assets, sem modificar linhas existentes. A pipeline API DEV atual aplica migrations remotas em merge na master antes do Worker.
2. Versionar flags, rotas, limites, policies e testes do Worker no repositório. Enquanto faltarem credenciais, manter as rotas fail-closed.
3. Versionar regras e índices Firestore para uma coleção com vínculos de pastas de storage, preservando driveFolders e seus documentos. Usar a pipeline Firebase existente.
4. Usar um PR para a validação de frontend, Worker e segurança. Fazer merge somente depois de cobertura e teste real com conta Dropbox; backups e rollback por flags.
5. Aplicar cron de retenção de tentativas de upload e transações OAuth; impedimento de exclusão de conta enquanto conexões ou ACLs persistirem.

## Infra — dependências externas reais, não necessariamente tarefas para o Codex

- Criar App Dropbox em https://www.dropbox.com/developers/apps, modelo **Scoped access, Full Dropbox**.
- Habilitar escopos account_info.read, files.metadata.read, files.content.read, files.content.write, e somente para acesso direto sharing.read/sharing.write. Nunca files.permanent_delete nem scopes de admin de equipe.
- Registrar redirect exato DEV: https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/dropbox/callback
- Configurar DROPBOX_APP_KEY e DROPBOX_APP_SECRET como secrets criptografados no Cloudflare. DROPBOX_OAUTH_REDIRECT_URI com o redirect acima e DROPBOX_ENABLED=true somente após testes. Nunca gravar segredo em GitHub/repositório.
- Ter conta Dropbox de teste, com consentimento, para E2E de OAuth, upload, mídia Range, álbum grande, pasta compartilhada e políticas empresariais. Validar aprovação do app para status de produção conforme regras do Dropbox.

Não é necessário delegar ao Codex se o proprietário ou uma conexão Cloudflare adequada puder criar app e segredos diretamente. GitHub sozinho não pode criar a aplicação no painel Dropbox nem estabelecer segredo num Worker remoto.

## Código — ordem de entrega

### A. Contrato e migração
- ProviderId google_drive/dropbox, capacidades, tipos de arquivo/identificador. file_id do Dropbox é id:... e não deve receber validação de IDs Google.
- D1 dropbox_connections, dropbox_oauth_transactions, dropbox_upload_attempts; coluna provider nos review_assets com default Google.
- Evitar colisões em ACLs e claims de permissões: chave de recurso composta por provider, connection e fileId. Comentários devem guardar assetRef estável por revisão.
- Firestore storageFolders (ou coleção específica Dropbox), regras por owner/projeto. Leitura conjunta dos vínculos legacy Drive e novos sem regravar os antigos.

### B. OAuth
- Start autenticado: estado aleatório com TTL 10 min e rate limit + PKCE S256. Navegação top-level para cookie SameSite Lax no Worker. Callback valida estado/cookie, UID, deletion fence, token e conta via users/get_current_account (account_id estável e email_verified).
- Refresh server-side com cache, lease e fencing para reconexões/desconexões concorrentes; erros classificados, sem despejar corpo de erros ou bearer em logs.
- Desconectar conta revoga token, bloqueia novas operações e não deixa revisões ativas órfãs. Exclusão da conta revoga todas credenciais e limpa tentativas/transações.

### C. Listagem/busca/preview
- list_folder/list_folder_continue com paginação e cache no cliente, raiz e Team Spaces com path root correto. search_v2 com filtro por pasta, desduplicação, delayed indexing e rate limiting.
- get_thumbnail_v2 limitado; fallback sem miniaturas para imagens acima de 20MB e formatos não suportados.
- Download de conteúdo pelo Worker com token do proprietário somente no backend, HTTP Range limitado, media ticket assinado por ativo/versão/pessoa/expiração. Nunca usar get_temporary_link no navegador.
- MIME seguro e Content-Disposition inline, no-store, nosniff. Não executar HTML/SVG em origem privilegiada.

### D. Upload
- Contrato separado do envio resumable do Google. Dropbox: upload_session/start, upload_session/append_v2, upload_session/finish.
- Worker autentica UID e verifica projeto e pasta ligada. Browser envia blocos controlados <=8MiB para Worker sem conhecer Bearer Dropbox.
- Sessão cifrada vinculada a UID, conexão+revisão, projeto, pasta, nome, tamanho e attemptId. Transições atômicas por offset; incertezas resolvidas pelo erro incorrect_offset ou estado remoto, nunca por avanço otimista.
- Priorizar upload direto somente se o mecanismo escolhido tiver CORS e sem exposição de credencial comprovados em testes reais. Tratar expiração (até sete dias na API), cancelamento, deduplicação, cotas e timesouts.
- Verificar ID, tamanho e diretório após finish; somente então notificar a fila React e atualizar a biblioteca.

### E. Aprovações
- Manter portal-first como padrão, independentemente de provedor. Participante autenticado pelo Roteiva, sem obrigatoriedade de conta Dropbox.
- O backend resolve metadata e verifica ancestry de arquivo dentro de pasta ligada, em provider selecionado.
- Reutilizar tickets HMAC e fluxo de mídia, player, zoom/touch/pinch, PDF, feedback por segundo, contagem de aprovadores, trocas de versão, expiração/rotacionar/encerrar.
- Compartilhamento nativo opcional: Dropbox sharing/add_file_member sob escopos específicos, com controle de propriedade das permissões e refcounts. Preservar ACLs preexistentes e falhar explicitamente quando o Dropbox Business bloquear compartilhamento.
- Ajustar owner workspace e composer para IDs do Dropbox e fallback de miniaturas/previews. Nunca formar URL do Google Drive para arquivo Dropbox.

### F. UX e QA
- Única Biblioteca com conexão por provedor, telas e estados consistentes, identificação discreta da origem e fluxo curto de conectar -> vincular -> trabalhar.
- Testes para conta cruzada (IDOR), OAuth CSRF, token revogado, saída de conta, upload duplicado e retomável, pasta removida, quota, respostas 429/5xx, Range video, mobile e acessibilidade.
- Teste real com arquivo de pelo menos 500MiB e vídeo com seek no portal; Chrome/mobile, Google e Dropbox simultaneamente.
- CI verde + smoke DEV com credenciais reais antes do merge. Não automatizar suite real E2E nas pipelines padrão; deixá-la manual.

## Entrega, liberação e rollback

Deploy DEV em camadas: migration aditiva -> worker com feature disabled -> regras Firestore -> UI -> secrets -> teste OAuth -> habilitar Dropbox DEV -> regressão Google -> QA isolado completo -> merge. Se falhar, desabilitar Dropbox sem reverter migration e sem apagar dados de usuários.

Links oficiais:
- https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/list-folder
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/download
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload-session-start
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload-session-append-v-2
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload-session-finish
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/sharing/add-file-member
