# Aprovações Google — participantes e reutilização segura de mídia

## Objetivo

Um mesmo material da pasta vinculada pode participar de múltiplas solicitações e versões, inclusive quando uma solicitação anterior já foi aprovada. O proprietário escolhe o material; não há regra de exclusividade por arquivo. O acesso ao portal não equivale à concessão de acesso geral ao Drive.

## Tipos de acesso

- **Link:** qualquer pessoa que possua o token válido de convite pode acessar. O Roteiva pode reutilizar acesso público já existente ou gerenciar uma ACL `anyone/reader`, com referências entre revisões; só remove uma ACL que criou quando não restam consumidores ativos.
- **Google:** exige Firebase ID Token assinado, associado a login `google.com` com e-mail verificado, e presença em `review_participants`. O token do link por si só não autoriza acesso. `reviewer` pode ler, comentar e registrar uma decisão; `viewer` só pode ler o estado, arquivos e comentários. O backend impõe esse controle mesmo quando a UI for manipulada.
- **Votos:** cada revisor dá uma decisão por versão. Um pedido de ajustes devolve a versão à produção; para aprovação final é preciso confirmação de *todos* os revisores. Contas leitoras não contam no quórum.
- **Prévia:** o Drive fornece iframe autenticado no modo Google; o relay de vídeo com ticket não é liberado para esse modo, pois a URL do elemento HTML5 `video` não propaga o Firebase ID Token.

## Permissões preexistentes no Google Drive

O erro `review_existing_public_permission` ocorre quando o arquivo ainda tem permissão pública, de grupo ou de domínio. É diferente de ter outros leitores nomeados, que não são motivo para bloquear publicação. Os e-mails informados como participantes recebem acesso `reader` no arquivo, aproveitando concessões que já existiam sem assumir sua propriedade. Participantes com papel de revisor no Roteiva também possuem apenas leitura no Drive; sua decisão acontece exclusivamente no portal.

O proprietário pode optar explicitamente por **remover acesso público direto** `anyone` do arquivo. Essa opção pode desativar links compartilhados anteriores e não é executada por padrão. O sistema nunca modifica ACLs herdadas de pastas: se alguma pasta ancestral permanece pública, de domínio ou grupo, a operação é bloqueada com orientação de configuração no Drive. O projeto não deve afirmar que um arquivo público se tornou privado apenas porque a página exige login.

Uma revisão Google já aprovada pode deixar de aceitar novas decisões, mas continuar disponível até seu encerramento/expiração. Uma nova revisão que utilize os mesmos arquivos e participantes cria uma solicitação distinta.

## Gerenciamento e ciclo de vida

- D1 `0015_review_participants.sql` migra o destinatário restrito antigo e introduz participações, votos e rastreamento dos leitores Google por arquivo.
- `review_google_acl` representa uma permissão gerenciada por par (arquivo, e-mail) e registra sua origem. `review_google_uses` lista solicitações que ainda precisam daquele acesso.
- `review_file_claims` protege a propriedade de ACLs públicas criadas pelo Roteiva; `review_link_uses` mantém consumidores adicionais enquanto o arquivo é compartilhado.
- Ao encerrar, o sistema remove apenas concessões da própria aplicação e apenas quando não houver outra solicitação ativa dependente. Permissões já existentes antes do Roteiva não são revogadas.
- Retentativas de publicação e revogação não podem adotar ACLs de terceiros; uso de leases e estados persiste as operações em andamento. A expiração e exclusão da conta continuam usando a rotina de encerramento existente.

## Limites

- Há limites técnicos de segurança: até 200 e-mails únicos por solicitação (revisores e leitores somados), com no máximo 64 KiB de metadados, e limite configurado de 8 arquivos por versão.
- O Google Drive pode impor políticas de compartilhamento da organização, limites de quota, e poderá exigir autorização de arquivo pelo Google Picker.
- Restringir acesso ao **portal** não retira, retroativamente, permissões preexistentes no Drive. O Roteiva comunica qualquer impedimento e exige ação explícita ou correção manual.

## Validação

`api/tests/reviews.test.mjs` cobre participantes com identidade Google, papéis, quórum, reutilização de ACLs Google e link em revisões simultâneas, restrição pública com consentimento, preservação de permissões do proprietário e bloqueio de media tickets no modo Google. Verificar os testes e as migrações da API e a regressão E2E desktop/mobile antes de liberar DEV.
