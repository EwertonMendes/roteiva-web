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
- [ ] Validar API Worker e builds com CI.
- [ ] Playwright desktop/mobile: cliente abre, comenta, aprova/solicita ajustes e reabre a página.
- [ ] Cenários A/B: proprietário A não cria convite para arquivo, pasta, projeto ou cliente B.
- [ ] Google real (duas contas): publicar link, modo Google específico, arquivo com permissão prévia, preview/fallback, nova versão, exclusão/expiração/desconexão e revogação ACL confirmada.
- [ ] Sem credenciais reais/tokens em traces, logs, URL de API e artefatos.
- [ ] PR revisada e somente então merge/deploy DEV; PROD está fora do escopo.
