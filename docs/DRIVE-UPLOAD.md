# Upload Google Drive — implementação DEV

## Estado e riscos

Implementado em PR isolada da PR #51: autorização da pasta vinculada pelo Firestore REST
(com o próprio Firebase ID Token), validação de descendência no Drive, abertura de
sessão resumable pelo Worker, transferência direta via XHR do navegador para Google,
progresso, fila de dois arquivos, cancelamento, retry limitado e confirmação
autoritativa do arquivo no Drive. Nenhuma mídia atravessa Worker, D1 ou Firestore.

**Não considerar validado em Google real enquanto a PoC de CORS / drive.file /
Google Picker não for concluída.** O browser precisa fazer PUT de blocos na URL
da sessão Google, ler status 308 e header Range, receber resposta final JSON.
Se a API Google não disponibilizar isso via CORS, não substituir por proxy de
vídeo no Worker nem colocar OAuth token de leitura ampla no navegador.

O OAuth existente concede drive.file + drive.readonly. A listagem via
drive.readonly **não concede escrita**. Em pasta já existente, drive.file pode
recusar a criação com HTTP 403. O backend retorna erro explícito; **Google Picker
oficial** com token somente drive.file é uma dependência para autorizar essas
pastas e não deve ser contornado com scope drive irrestrito.

## Contratos DEV

- POST /integrations/drive/:connectionId/folders/:folderId/uploads
  - Body: projectId, linkedFolderId, name, size, mimeType
  - Response: sessionUrl, chunkSize
- POST /integrations/drive/:connectionId/folders/:folderId/uploads/complete
  - Body: projectId, linkedFolderId, fileId, size
  - Response: file (id, name, mimeType, size, webViewLink)

Ambos exigem Firebase ID token válido, entitlement ativo, Origin exata,
rate limit por UID, conexão do próprio UID, documento driveFolders no Firestore
autorizado pelas Rules e pasta de destino descendente da pasta vinculada. Nenhuma
URL enviada pelo cliente é buscada pelo Worker. Google upload session Location
tem HTTPS, host e path verificados antes de retornar ao navegador.

A URL da sessão é **capability secret**: não registrar, salvar em localStorage,
incluir em analytics ou compartilhar. Vive somente na memória. Uma sessão Google
já emitida pode continuar aceitando bytes até expirar mesmo após logout/revogação:
bloqueio de novas sessões não invalida instantaneamente uma capability já emitida.

Tamanho de blocos: 8 MiB, múltiplo de 256 KiB. Limite por arquivo: 5 TB.
Fila: dois uploads simultâneos. Não substitui arquivos pelo nome.
Arquivos vazios são rejeitados. UI não persiste bytes do File nem promete retomar
após refresh; retry é apenas com a mesma página aberta. Em confirmação incerta
não reenvia automaticamente para evitar duplicatas.

Ao confirmar no Google, invalida só o cache da pasta destino e atualiza a lista.

## QA

Automático sem Google real:
- api/tests/uploads.test.mjs: vínculo, isolamento, descendência, 403,
  metadados, rejeição de URL e confirmação de pasta/tamanho.
- tests/drive-upload.test.mjs: host permitido, blocos, Range, upload sem bearer.
- Pipelines existentes: testes, typecheck, regressão Playwright desktop/mobile.

Integração real obrigatória:
1. Conta Google A e B; pasta vinculada pré-existente e pasta autorizada;
   verificar drive.file e erro quando sem direito de escrita.
2. Chromium, Firefox, Safari, Android/iOS reais; drop no desktop, botão mobile,
   temas claro e escuro.
3. Vídeo acima de 250 MB; conexão instável, 308 Range, retry e cancelamento.
4. Login B não opera pasta de A. Assinatura expirada e conta em exclusão
   não podem emitir nova sessão.
5. CORS real: preflight PUT, Content-Range, 308, Range exposto, JSON final.
6. Google Picker com token exclusivamente drive.file e conta Google correta.
7. Smoke DEV, cache, previews, busca e suites E2E com evidências de execução.

## Pendências deliberadas

- Não há migração D1: Drive é a fonte de verdade; fila não sobrevive ao F5.
- Sem deploy PROD, escopo drive irrestrito ou nova service account.
- Google Picker depende de configuração no Google Cloud (API key, APP ID)
  e fluxo seguro de token drive.file. Deve ser implementado/validado antes do
  lançamento externo caso as pastas existentes não aceitem gravação.
- Não mergear automaticamente com compatibilidade real CORS ainda desconhecida.
