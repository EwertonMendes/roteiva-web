# Upload Google Drive — PR #52

## Estado em 20/10/2026

**IMPLEMENTADO e em revisão; integração Google real BLOQUEADA para homologação.**
Não fazer merge nem anunciar upload validado com base em mocks. Publicação
temporária de homologação em DEV autorizada pelo proprietário em 20/10/2026,
sem merge, com reversão para master em caso de falha. PROD permanece fora do escopo.

Auditoria: branch existente `feat/drive-resumable-upload`, HEAD original
`556e467`; CI anterior verde. Incorporada a master `8f64876` para preservar as
PRs #51/#53/#54. Checkout separado; mudanças locais de outro trabalho preservadas.

Problemas corrigidos: confirmação aceitava arquivo existente sem uma tentativa;
links de pastas podiam sobreviver à exclusão do projeto; capacidade de escrita
não era verificada no destino quando subpasta; progresso contava bytes enviados
pelo XHR antes de confirmação; probes de recuperação com falha podiam ser seguidos
por reenvio; fila era desmontada ao sair da Biblioteca; faltava Google Picker.

## Fluxo e contratos

Firebase Auth → Worker verifica JWT, Origin, entitlement D1 e rate limit → conexão
por UID → vínculo e projeto via Firestore REST com o mesmo Firebase ID Token →
ascendência real no Drive, pasta não excluída e `canAddChildren=true` → permissão
por aplicativo (`isAppAuthorized`) → sessão Google → bytes navegador→Drive →
confirmação autoritativa pelo Worker. Nenhum binário passa pelo Worker ou é
armazenado no D1/Firestore/Storage.

Rotas sob `/integrations/drive/:connectionId/folders/:folderId/uploads`:

| Operação | Payload / retorno |
|---|---|
| POST base | `attemptId` UUID v4, `projectId`, `linkedFolderId`, `name`, `size`, `mimeType`; devolve `attemptId`, `sessionUrl`, `chunkSize` |
| POST `/complete` | `attemptId`, `projectId`, `linkedFolderId`, `fileId`, `size`; devolve arquivo verificado e thumbnail ticket quando disponível |
| POST `/authorize` | `projectId`, `linkedFolderId`; devolve `authorized:true` ou configuração pública mínima do Picker |
| POST `/integrations/drive/:connectionId/picker/verify` | `accessToken` efêmero GIS; devolve `verified:true` após conferir cliente, identidade, escopos e validade |

Todas as rotas exigem JWT válido, Origin DEV exata, entitlement ativo e rate limit.
Tamanho de metadados limitado a 8 KiB **durante** a leitura do stream. Nomes,
identificadores, inteiros e MIME são validados; conversão para tipos nativos Google
não faz parte deste upload binário. Arquivos vazios são rejeitados; limite máximo
5 TB, sujeito a limites reais/quota da conta Google.

## Tentativas e integridade

Migration aditiva `0012_drive_uploads.sql`: uma tentativa por `(owner_uid,id)`,
conexão/revisão, projeto/raiz/destino, nome, MIME, tamanho e um ID de arquivo
**pré-gerado pelo Google** (`files.generateIds`). A reserva precede o POST Google.
A confirmação só aceita esse ID e os metadados autorizados, além de rever vínculo,
ascendência, conexão e tamanho. Um arquivo arbitrário preexistente não satisfaz
a tentativa. Confirmação repetida é idempotente.

A capability URL é cifrada AES-GCM com AAD específico da tentativa/UID/conta/conexão
no D1; permite recuperar a resposta de início perdida usando o mesmo attemptId.
Não vai para Firestore, localStorage, URLs de navegação, analytics ou logs.
TTL de aplicação: 24h; após confirmação o ciphertext é apagado. Cron existente
remove até 100 registros expirados por execução. FK remove tentativas quando a
conexão é excluída. Uma reserva cujo POST ficou incerto não emite outra criação.
Reconexão/revisão diferente invalida a tentativa conservadoramente.

O host HTTPS e path Google são exatos, sem porta, credenciais, fragmento ou redirects
automáticos. A autorização limita a ascendência a 32 níveis e tem orçamento de
42 fetches externos, incluindo redirects, abaixo do teto Free de 50. O início inclui Origin DEV; isso é preparação para CORS e **não é
prova de compatibilidade**. Uma capability Google já emitida pode aceitar bytes
até expirar, mesmo após desconexão; não prometemos revogação instantânea dela.
Novas operações Worker são negadas; o cliente interrompe pedidos no logout,
desconexão, encerramento do workspace ou cancelamento.

## Google Picker e menor privilégio

O OAuth confidencial existente (`drive.file + drive.readonly`) continua somente
no backend, com refresh token cifrado. Seu bearer não é enviado ao browser.
Quando `isAppAuthorized` já é verdadeiro, não se pede Picker novamente. Caso
contrário, a fila oferece **Autorizar pasta no Google** e preserva os arquivos.

GIS Token Model em gesto explícito solicita **novo** access token com
`include_granted_scopes:false`, escopos `openid drive.file` e `login_hint` do
subject da conexão. `openid` é necessário para identidade estável; não se pede
email, profile, readonly ou escrita irrestrita. Não há tentativa de reduzir um
token já emitido. Browser e Worker recusam escopos inesperados. Worker consulta
`tokeninfo` por POST (credencial no body) e exige audience/authorized party do
cliente configurado, validade mínima e o subject da conexão; usa OIDC UserInfo
como fallback oficial se tokeninfo não incluir subject.

Só depois dessa verificação o token chega ao Picker, com `setAppId` do mesmo
projeto do OAuth client. O usuário deve selecionar a pasta exata; em seguida o
Worker revalida a permissão real. Token, instância do Picker e callbacks ficam
apenas em memória, com descarte, cancelamento e timeout. Cancelar/recusar não
inicia upload; depois de autorizar, **Tentar novamente** usa o arquivo da fila.
O popup nativo Google controla sua aparência; o aviso Roteiva segue claro/escuro,
teclado e viewport móvel. Aparência do diálogo Google real ainda exige QA.

## Transferências e experiência

Fila global ao workspace, dois uploads simultâneos, até 100 entradas; destino
copiado no enqueue. Navegar por pastas/projetos e outras telas não redireciona
nem interrompe arquivos. Barra flutuante recolhível, nome/destino/status por
arquivo e controles acessíveis. Blocos de 8 MiB, múltiplos de 256 KiB; `File.slice`
evita materializar o vídeo inteiro em JavaScript. Handles liberados ao concluir,
cancelar ou dispensar. Progresso conta somente bytes confirmados pelo Google.

PUT via fetch com Content-Range, credentials omitidas e redirects bloqueados;
308/Range define offset; 200/201 encerra transporte.
Após rede/timeout/429/5xx/403 de rate limit: backoff exponencial com jitter,
no máximo quatro recuperações consecutivas sem progresso, e probes vazios antes
de qualquer reenvio. Probes que falham **não liberam** nova escrita. 401,
permissão, expiração e armazenamento têm mensagens específicas. Após esgotar retries
de rede, **Retomar envio** preserva File/session somente em memória e consulta o
estado remoto antes de escrever; usa o mesmo attemptId, sem nova criação. Confirmação
incerta oferece **Verificar conclusão**, sem reenviar bytes. Cancelamento depois
do início informa que um arquivo pode já ter sido recebido pelo Google.

Somente cache da pasta destino (incluindo suas buscas/páginas) é invalidado.
Arquivo verificado entra na lista/grade/busca local atual; miniatura usa ticket
privado se Google já o fornecer. Processamento assíncrono de miniaturas no Google
pode exigir nova abertura da pasta; não há polling de thumbnails ou reload global.
Sem gravações Firestore no upload.

F5/fechar aba perde fila e seleção dos arquivos; `beforeunload` alerta enquanto
há trabalho. **Não há retomada entre sessões**: não guardamos Files nem capability
no navegador. Antes de selecionar novamente após uma falha incerta, conferir o
Drive. D1 sozinho não restaura o File escolhido nem promete retomada após F5.

## Configuração externa e bloqueios observados

Inspeção do Console e configuração autorizada em 20/10/2026 confirmaram:

- Projeto `roteiva-drive-dev`, número `479738001561` e cliente Web existente
  `479738001561-4gu97o42v4m8kiq1bga8ck3msmjp0me3.apps.googleusercontent.com`.
- Origem JavaScript `https://roteiva-web-dev.web.app` já autorizada; callback
  `https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback` preservado.
- Chave **Roteiva Picker DEV** criada com restrição de aplicativo Sites,
  `https://roteiva-web-dev.web.app/*` e somente **Google Picker API**.
  Restrição salva conferida no Console; valor não versionado.
- Worker `roteiva-api-dev` contém o secret **GOOGLE_PICKER_API_KEY**, confirmado
  por `wrangler secret list --env dev`. Temporário local fora do OneDrive apagado.
- Consulta D1 somente de estado confirmou uma conexão com acesso ativo. A sessão
  inicialmente aberta estava expirada; não se alterou entitlement para liberar QA.

Ações externas necessárias, sem inventar valores:

1. **CONCLUÍDO:** no [Console de credenciais](https://console.cloud.google.com/apis/credentials?project=roteiva-drive-dev),
   chave Google Picker com restrição de aplicativo **Sites**, referrer
   `https://roteiva-web-dev.web.app/*`, e restrição de API **Google Picker API**.
   Conferir Google Picker API e Google Drive API habilitadas no mesmo projeto.
   Não reutilizar a chave Firebase de outro projeto, nem criar chave irrestrita.
2. **CONCLUÍDO:** chave restrita como Worker Secret `GOOGLE_PICKER_API_KEY` no Worker
   **roteiva-api-dev**; pelo terminal confiável: `npx wrangler secret put GOOGLE_PICKER_API_KEY --env dev`
   dentro de `api/`. Não colar a chave no chat/repo. O Picker precisa recebê-la
   temporariamente como developerKey; restrição de domínio/API é a proteção.
3. Manter OAuth consent screen em Testing, com as duas contas de teste autorizadas
   e escopos necessários já descritos. Não ampliar para `drive` irrestrito.
4. **HOMOLOGAÇÃO TEMPORÁRIA AUTORIZADA:** proprietário aprovou explicitamente a
   exceção pontual ao gate master-only, sem alterar os workflows ou fazer merge.
   Migration **0012 aplicada no D1 DEV**; contagens existentes preservadas,
   `quick_check=ok` e nenhuma violação FK. Worker do código `42934b6` publicado
   como versão `eafb4b25-8dd6-4d64-a5e0-7db05fbc60fe`, seguido do Hosting DEV;
   smoke público e cache aprovados. Código master `8f64876` preservado para
   reversão; release anterior do Hosting copiada para canal `pr52-before-qa`.
   Credencial Wrangler renovada com único escopo adicional `workers_scripts:write`,
   especificamente autorizado, após recusa do endpoint de deployments.
   [Prévia oficial independente](https://github.com/EwertonMendes/roteiva-web/actions/runs/39471092108)
   também passou, mas sua origem não está autorizada para integração Worker/Picker;
   não ampliar CORS/OAuth para usá-la. Não houve merge nem alteração em PROD.
   Smoke HTTP remoto da rota de upload: OPTIONS DEV=204 com origem exata,
   POST sem JWT válido=401 e origem externa=403. Isso prova CORS do Worker,
   **não** CORS do Google nem transferência real.
5. Disponibilizar UID de teste com acesso ativo, conexão própria e pasta descartável
   vinculada. Uma conexão com acesso ativo já foi identificada no DEV.
   Login/reativação devem seguir o fluxo normal autorizado do produto.
6. Comprovar: autorizar pasta existente no Picker, conferir conexão A/B, executar
   vídeo >250 MiB com recuperação real e checar arquivo na pasta correta. Testar
   revogação/reconexão e Safari/dispositivo físico. Só então retirar draft.

O login normal no frontend DEV retornou **Login cancelado** após a seleção
automatizada da conta. Solicitada entrada normal pelo proprietário para continuar
sem extrair tokens pessoais nem usar credencial administrativa para impersonação.
Ainda não há arquivo enviado ao Google nem prova de autorização Picker real.
Vídeo sintético de QA preparado fora do OneDrive: AVI válido, 1.200 frames/40s,
276.509.032 bytes (>250 MiB), sem conteúdo pessoal; não versionado.

## QA automatizado e prova real

- `api/tests/uploads.test.mjs`: Firestore/Google sintéticos, SQLite real, metadata,
  vínculo/projeto, subpastas, permissões, sessão criptografada/idempotência,
  expiração, confirmação inválida, reconexão, Picker/conta/cliente/escopos/quota.
  Exercita também `handle` com Firebase JWT assinado sintético e JWKS simulado:
  identidade inválida, Origin, entitlement ausente/suspensão e usuários A/B.
- `tests/drive-upload.test.mjs`: ranges, bytes confirmados, falhas sucessivas de
  status, confirmação perdida, quota, cancelamento e slicing de arquivo grande
  **sintético**, sem alocar o conteúdo. Não é vídeo real de 301 MiB.
- `tests/browser/drive-folders.spec.ts`: botão/drop, mobile/desktop, concorrência,
  navegação, cancelamento, claro/escuro, lista/grade/filtro, confirmação sem
  duplicação e contrato GIS/Picker simulado com recusa e recuperação.
- `pnpm build:emulator && pnpm build:demo`; QA isolado:
  `pnpm exec firebase emulators:exec --project demo-roteiva --only auth,firestore "pnpm exec playwright test tests/browser/drive-folders.spec.ts"`.
  Emuladores usam projeto fictício; provedores Google são simulados.

Prova real reproduzível: `node scripts/qa-drive-real.mjs`. O script bloqueia sem
fixtures explícitas e não é executado no CI público. Usa Chromium sem perfil
pessoal/tracing, abre a origem DEV e transfere um arquivo local via o **mesmo
cliente de produção** transpilado. Exige estas variáveis no ambiente seguro:

- `ROTEIVA_QA_FIREBASE_TOKEN`: ID Token atual do UID de teste ativo, nunca refresh token.
- `ROTEIVA_QA_DRIVE_CONNECTION`, `ROTEIVA_QA_DRIVE_FOLDER`,
  `ROTEIVA_QA_DRIVE_LINKED_FOLDER`, `ROTEIVA_QA_PROJECT_ID`: destino descartável previamente autorizado.
- `ROTEIVA_QA_VIDEO_FILE`: caminho absoluto de vídeo de teste >250 MiB.
- `ROTEIVA_QA_DISPOSABLE_FOLDER=yes`: reconhecimento de fixture descartável.
- `ROTEIVA_QA_INTERRUPT=yes` opcional: descarta localmente um acknowledgement
  **real** 308 para obrigar status query real, sem simular respostas Google.

Saída contém apenas tamanho, progresso, contagens de status e verificação. Não
registra identidade, nomes, tokens, IDs ou capability URLs. Arquivo é preservado
na pasta de teste; não há exclusão automática. Expirar token/estado deve produzir
falha, nunca sucesso presumido. A prova ainda **não foi executada com credenciais**:
CORS/preflight/Range/200–201 e vídeo real permanecem não comprovados.

## Referências oficiais consultadas

- [Uploads e recuperação](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Picker Web](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Escopos do Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Recurso files e capacidades](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [IDs pré-gerados](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- [GIS TokenClient / include_granted_scopes](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [OIDC / UserInfo](https://developers.google.com/identity/openid-connect/reference)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Limites documentados e exemplos oficiais não substituem observação no navegador.
Bytes de vídeo continuam fora do Worker; não foi introduzido proxy alternativo.

### Evidência local desta revisão

- API: **114/114** testes passaram, incluindo binding D1/workerd isolado;
  TypeScript, migrations locais até 0012 e bundle dry-run aprovados.
- Frontend: **37/37** unitários, mais scripts de Agenda e Financeiro aprovados;
  TypeScript e builds Firebase/emulator/demo aprovados.
- Firestore Rules: **30/30** testes A/B nos emuladores passaram.
- QA Drive isolado: **15 aprovados, 3 skips previstos** por plataforma;
  inclui contrato Picker simulado e transferência com fetch sem redirects. Cenário
  adicional de retomada explícita e regressão da confirmação executados em
  desktop/mobile; evidência do conjunto final vinculada na PR.
- Revisão visual da fila desktop/mobile em tema escuro identificou transparência
  sobre o conteúdo; fundo opaco corrigido e cenário de geometria/captura reexecutado.
- Script real sem fixture: bloqueio seguro esperado; **nenhum upload Google real**.

Os checks públicos do HEAD e QA manual no GitHub são vinculados na descrição da PR.
Estas contagens locais não validam os itens Google reais ainda bloqueados.
