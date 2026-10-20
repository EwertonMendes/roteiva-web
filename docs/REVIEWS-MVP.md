# Aprovações de materiais — MVP (PR #55)

## Escopo implementado na branch

O fluxo usa a Central de Aprovações do workspace, vínculos existentes de Clientes/Projetos e as pastas autorizadas da Biblioteca Google Drive. Não migra mídia para o Roteiva. O profissional pode escolher até 8 arquivos (vídeo, imagem, áudio ou PDF), criar uma solicitação em rascunho, publicar, copiar/compartilhar link, receber comentários e decisão, enviar nova versão após ajustes e encerrar/revogar.

A rota pública `/review/{capability}` funciona sem cadastro no Roteiva. O modo **link** concede `reader/anyone` somente aos arquivos selecionados no Drive, com aviso explícito sobre o acesso por link. O modo **Google** exige e-mail autorizado e autenticação Google via Firebase Auth no portal; o Worker compara as claims verificadas do provedor, independentemente de inscrição comercial no SaaS. O portal não mostra financeiro, outros clientes nem dados de projetos fora da revisão.

**Importante:** quem tem acesso direto à URL do Google Drive pode visualizar arquivos concedidos publicamente enquanto a ACL existir, mesmo depois de perder o link do portal. O Roteiva solicita revogação dessas ACLs ao encerrar, substituir uma versão, excluir conta ou expirar o convite. A revogação externa depende da disponibilidade do Google/credenciais. Quando ela não pode ser confirmada, a revisão permanece indisponível no portal e a operação exige nova tentativa/suporte. Arquivos baixados anteriormente não podem ser revogados. Não apresentar a identidade digitada no modo link como autenticação ou assinatura legal.

## Dados, segurança e infraestrutura

- D1 `0013_reviews.sql`: solicitações, arquivos por versão, comentários e decisões. D1 suporta o portal público e coordenação de ACLs; o Firestore permanece o registro mestre privado de clientes/projetos e das pastas autorizadas.
- `api/src/reviews.ts`: verificação real com ID Token Firebase para cliente, projeto e vínculo de pasta; validação da ascendência dos arquivos na pasta do projeto usando metadados Google, `isAppAuthorized` e `capabilities.canShare`. Nenhum `fileId` vindo do browser autoriza por si só a publicação.
- Tokens de convite aleatórios de 256 bits, SHA-256 para procura e criptografia autenticada AES-GCM para recuperar o link pelo proprietário. Não armazenar token em log, métricas ou Firestore. Portal envia a credencial no cabeçalho `X-Review-Token` e utiliza `no-referrer` para mídia e links externos.
- Permissões preexistentes de usuários Google não são propriedade do Roteiva e **não** são revogadas. Se um arquivo já tiver ACL `anyone` antes do convite, o modo link rejeita a publicação (o sistema não pode prometer controlar sua revogação). Google Drive permanece autoridade da permissão.
- Estados internos `publishing`, `replacing` e `closing` recusam acessos públicos durante operações parciais. Permissões bem-sucedidas são registradas por arquivo; tentativas posteriores conciliam o estado. Decisões são únicas por versão.
- Acesso do dono exige assinatura válida no backend; acesso do revisor restrito exige e-mail Google verificado; o modo link usa token de capacidade com expiração e limite de taxa.
- Cron limpa convites expirados gradualmente; ao desconectar Drive, primeiro é preciso encerrar convites ativos. Na exclusão de conta, revoga convites antes de invalidar OAuth, com processamento limitado por execução.
- Este recurso **não concede** acesso administrativo, não altera regras Firestore privadas, não usa proxy para vídeos, não cria buckets e não altera os fluxos de upload.

## Fluxo de uso

1. Cadastre o cliente e um projeto vinculado. Na Biblioteca, conecte o Drive e vincule uma pasta ao projeto. Faça upload nessa pasta ou use arquivos existentes autorizados. O compositor também utiliza a fila de upload resumable já existente, com seletor local e arrastar/soltar, selecionando o material automaticamente quando o Google confirma a conclusão.
2. Abra Aprovações ou use o atalho no projeto/cliente. Selecione cliente, projeto, modalidade de acesso, título, validade e arquivos.
3. Clique em Gerar aprovação. A solicitação começa em rascunho, concede no Drive somente os arquivos escolhidos e, após confirmação, passa para Aguardando cliente. Se falhar, o rascunho fica recuperável.
4. Compartilhe a URL por cópia, WhatsApp ou e-mail. O Roteiva prepara o texto; não afirma que a mensagem foi enviada.
5. O cliente abre a URL, visualiza no Google Drive incorporado (fallback Abrir no Drive), comenta e aprova ou solicita ajustes; confirmação de decisão é explícita.
6. Se houver ajustes, envie outra versão com novos arquivos. A versão anterior permanece no histórico, mas as permissões Roteiva anteriores são revogadas antes de publicar a nova.
7. Encerre quando terminar. Se aparecer Revogação pendente, a solicitação já está fechada para o cliente no portal; concluir/repetir a revogação no sistema quando o Drive voltar.

## Recuperação e limitações intencionais

- Sem notificações automáticas, streaming próprio, anotações gráficas, aprovação parcial por arquivo, inbox do cliente, assinatura legal ou player próprio.
- Arquivos do tipo Google Docs e outros formatos nativos não integram o seletor deste MVP.
- Se a pessoa trocou o Google Drive de conta, removeu permissões manualmente, eliminou um arquivo ou ficou sem acesso à API, mostrar erro recuperável; não presumir que o arquivo foi compartilhado/revogado.
- Na modalidade Google, um navegador que bloqueia cookies de terceiros pode não reproduzir a prévia em iframe: use Abrir no Drive com a conta autorizada.
- O teste em preview temporário não é prova de compartilhamento real: a API DEV usa uma allowlist de Origin específica. O aceite final depende de publicar/validar as migrações e o frontend no ambiente DEV controlado.
- Testar quotas/limites de Drive, compartilhamento externo proibido por Google Workspace e casos de permissão preexistente antes do piloto.

## Checklist de aceite

- [ ] Migrar D1 no DEV com verificação de integridade e preservar o estado anterior.
- [x] Validação local da API Worker, frontend, typechecks e builds; CI do SHA final deve ser conferido na PR.
- [x] Playwright desktop/mobile: cliente abre, comenta, aprova/solicita ajustes e reabre a página (contratos simulados; Firestore/Auth emulados).
- [x] Isolamento A/B com Firebase assinado/Google simulado na API e regras A/B nos emuladores; duas contas reais continuam pendentes.
- [ ] Google real (duas contas): publicar link, modo Google específico, arquivo com permissão prévia, preview/fallback, nova versão, exclusão/expiração/desconexão e revogação ACL confirmada.
- [ ] Sem credenciais reais/tokens em traces, logs, URL de API e artefatos.
- [ ] PR revisada e somente então merge/deploy DEV; PROD está fora do escopo.

## Auditoria adicional — 20/10/2026

**IMPLEMENTADO e testado localmente; homologação Google remota continua pendente.** A execução anterior `39489418187` terminou com sucesso no SHA `20a2b38`. Havia somente a PR #55 aberta, sem conflito de merge com a master `650897a`, no início desta auditoria.

Correções verificáveis:

- Permissão de um arquivo não pode ser adotada por outra revisão ativa. Lease por arquivo impede duas concessões ou concessão/revogação simultâneas. Compensação que falha preserva o ID e o estado para retry; encerramentos incompletos são retomados pelo cron mesmo antes da expiração.
- Uma aba com material antigo não aprova/comenta uma versão nova. IDs privados e e-mail do destinatário não são retornados ao convidado. ACLs de grupo/outros usuários também impedem a promessa de Google restrito.
- Duas trocas de versão não misturam materiais no D1; somente a transição vencedora insere a versão seguinte.
- Publicação aguarda os uploads e sua confirmação. Progresso, cancelamento e recuperação ficam acessíveis no compositor usando a fila existente. A conclusão seleciona o arquivo mesmo após navegar para outra subpasta.
- Respostas antigas de pasta/listagem não substituem a navegação atual. O grid do modal preserva a altura da lista de arquivos e o fundo é opaco; anteriormente a lista colapsava e os arquivos não recebiam cliques. Diálogos reutilizam contenção de foco, Escape e bloqueio de scroll da Biblioteca.
- Falha ao recarregar o portal remove a mídia anterior e apresenta recuperação, sem manter material de uma resposta que já foi recusada.

Resultados locais finais nesta auditoria:

| Verificação | Resultado |
|---|---|
| API completa (`npm test` em `api/`) | 129/129; inclui 15 testes de revisão, D1/workerd real local e regressão de OAuth/acesso/exclusão/upload |
| Frontend (`pnpm test`) | 37/37, mais suítes de cálculo de agenda e financeiro aprovadas |
| Security Rules (`pnpm test:firebase`) | 30/30 em Auth/Firestore fictícios |
| Browser (`pnpm test:firebase`) | 81 aprovados, 3 ignorados por viewport, zero falhas; inclui 8 cenários de aprovação (4 por viewport) |
| TypeScript | frontend e API aprovados |
| Builds | Firebase, demo, emulator e bundle Worker dry-run aprovados |
| D1 local | migrations 0001–0014 aprovadas; repetição sem pendências; constraints/rollback verificados no workerd |

Os skips são testes desktop de múltiplas pastas/miniaturas no projeto mobile e o teste específico de picker mobile no projeto desktop; há casos correspondentes no viewport apropriado. As capturas `professional-review.png` e `customer-approved-v2.png` são produzidas pelo E2E em cada viewport. Traces e arquivos com credenciais reais nunca devem entrar no Git. Logs completos e capturas desta execução foram preservados localmente para o proprietário; a fonte reprodutível permanece nos testes e no workflow.

Evidências automatizadas: `api/tests/reviews.test.mjs` cobre HTTP com Firebase assinado e Google simulado, isolamento A/B, Google autorizado/incorreto, ACL preexistente, grupos/domínio/terceiros, criação fora da pasta, resposta Google perdida, grant versus close com compensação falhando, retry pelo cron, publicação concorrente, troca de versão concorrente e decisão duplicada. `tests/browser/reviews-workflow.spec.ts` usa Auth/Firestore emulados e um contrato HTTP de revisão com estado e validação de todos os payloads; percorre criação de cliente/projeto, upload direto em dois blocos (308/Range), bloqueio até confirmação, comentário, ajustes, V2, aprovação e encerramento. `tests/browser/reviews.spec.ts` cobre aprovação direta, confirmação de ajustes e recuperação de rede. Esses testes **não** homologam o Google real.

### Infraestrutura observada (somente leitura)

Cloudflare DEV consultado em 20/10/2026: cron real `* * * * *` configurado; D1 tem migrations até `0012_drive_uploads.sql`; `PRAGMA foreign_key_check` remoto retornou zero violações. `0013`/`0014` foram aplicadas apenas no D1 local, com segunda execução sem migrações pendentes. A rotina de revisões ainda não está publicada no Worker DEV; cron configurado não comprova execução remota dessa rotina. Nenhum recurso DEV/PROD ou dado existente foi migrado nesta auditoria.

O pipeline oficial da API exige master e SHA atual para deploy DEV. A PR permanece draft sem merge: não contornar esse gate com publicação manual da branch no Worker compartilhado. O preview Hosting oficial pode mostrar a UI, mas **não homologa o fluxo conectado**: a API atual ainda não contém `/reviews`, e a allowlist CORS aceita apenas a origem DEV principal. Isso precisa de uma decisão de ambiente para homologar a API antes do merge, ou aprovação humana para a etapa DEV prevista pelo projeto.

### Procedimento de aceite Google real ainda necessário

O proprietário autorizou e foi criada uma pasta nova descartável no seu Drive, com uma imagem PNG de teste, confirmadas por metadados da API (somente ACL de proprietário). Isso valida criação/upload pelo conector, **não** a integração de revisão do Roteiva. Referências exatas são entregues ao proprietário fora do repositório público.

1. Disponibilizar Worker com código da PR e D1 isolado com migrations `0001`–`0014`, OAuth/segredos e origem Hosting compatíveis pelo pipeline aprovado. Não apontar preview para banco de produção nem remover dados DEV existentes. Para um novo ambiente, separar recursos e credenciais; não exportar tokens do D1 nem segredos do Worker.
2. Na conta proprietária, vincular a pasta descartável a um projeto de teste e autorizá-la pelo Picker do Roteiva. Um arquivo criado por outro aplicativo pode ainda precisar de autorização `drive.file`.
3. Criar aprovação modo link somente para o PNG de teste; conferir `permissions.list` do próprio arquivo antes/depois (`supportsAllDrives=true`, campos `id,type,role,emailAddress,permissionDetails`). Confirmar `anyone/reader`, abrir o portal sem sessão e testar preview/fallback.
4. Encerrar, conferir remoção da ACL criada pelo Roteiva e recusar o token antigo. Repetir com vencimento controlado no ambiente **isolado**, observar execução do cron e confirmar remoção externa; não alterar validade em dados reais.
5. Repetir com duas identidades Google distintas em modo restrito: destinatário correto entra; conta incorreta recebe recusa no backend. Conferir ACL `user/reader` e posterior remoção. Testar ACL externa preexistente sem apagá-la, herança/Shared Drives, restrição Workspace e falha temporária Google.
6. Solicitar ajustes, publicar V2 e comprovar revogação de V1; repetir encerramento durante concessão, desconexão e exclusão usando **somente uma conta descartável**, nunca a conta pessoal do proprietário. Validar Safari e aparelho físico separadamente da viewport mobile Chromium.

Não registrar ID Tokens, URLs de sessão resumable ou capacidades de convite em logs/traces públicos. Na falha de migração, manter código anterior e schema aditivo; inspecionar conflito/backup antes de tentar de novo. Não remover tabelas de revisão para voltar código: isso perderia a referência às ACLs que ainda precisam ser revogadas.
