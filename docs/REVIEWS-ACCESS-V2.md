# Revisões — mídia e acesso unificados

## Política de acesso

- Todos os novos convites são **portal-first**, tanto em modo "link" quanto em modo Google.
- No modo link, o token secreto da revisão autoriza acesso ao portal. Ter o link equivale a uma capacidade de leitura; compartilhe-o apenas com os participantes desejados.
- No modo Google, o Worker exige ID Token Firebase com login `google.com`, email verificado e participação ativa em D1 antes de apresentar metadados, comentários ou emitir tickets de mídia.
- **Revisor** pode comentar, votar e pedir ajustes; **leitor** acompanha sem votar. Todos os revisores precisam aprovar a versão.
- O estúdio pode optar expressamente por **também** compartilhar arquivos originais diretamente no Google Drive com cada participante. Nesse caso, o backend gerencia ACL de leitura e conserva concessões já existentes.
- O padrão não cria permissões públicas nem concede acesso aos participantes dentro do Google Drive. Permissões diretas ou herdadas preexistentes do arquivo original continuam existindo e **não** são alteradas implicitamente.
- Compartilhamento direto pré-existente não é revogado pela expiração do portal. Não afirmar que um arquivo já público ficou privado por criar um convite restrito.
- A migração `0016_portal_first_review_access.sql` preserva `drive_share_enabled=1` para convites anteriores; novos convites usam `0` salvo opção explícita.

## Visualizador único

- Um endpoint de emissão de **ticket de mídia** valida a revisão e, se necessário, o participante Google. Serve imagens, vídeos, áudios e PDFs, sem Google Drive iframe.
- Ticket limitado a 12 minutos, assinado HMAC com keyring, escopo único de arquivo/versão/revisão, compromisso SHA-256 da identidade autorizada para evitar email em URLs.
- Cada GET/HEAD e cada requisição Range ao Worker valida HMAC, expiração, estado e versão da revisão, seleção exata do arquivo e permanência do participante Google. O Worker usa somente OAuth de proprietário e não expõe a credencial Google.
- O ticket é uma capacidade transitória: **não é equivalente a reautenticar a sessão Firebase a cada GET nativo de mídia**. Possui vida curta, é renovado via autenticação, não é armazenado em cache, possui política no-referrer e deixa de funcionar ao encerrar/rotacionar a revisão. Não exibir a URL em logs.
- O Worker aceita apenas uma faixa Range por requisição; limite 8 MiB por segmento em vídeo. Imagens e PDFs permitem streaming HTTP sem carregar o arquivo inteiro no Worker.
- A UI unificada usa o mesmo componente de imagens com zoom, arraste, mouse, pinça, enquadramento e tela cheia; player HTML5 nativo para vídeo/áudio, controle de tempo, fullscreen, PDFs via visualizador nativo do navegador.
- Durante reproduções longas, o portal renova o ticket mediante sessão autorizada e restaura o ponto da reprodução.
- Suporte a codecs depende do navegador: não há transcodificação automática. PDFs têm suporte dependente do leitor PDF do navegador; navegadores sem renderização embutida podem precisar baixar o arquivo.
- Arquivos compartilhados via Drive Picker precisam estar autorizados ao app com o escopo `drive.file`. Caso contrário, a criação orienta a autorizar pelo fluxo do Roteiva; não ampliar para escopos globais.
- Rotas legadas `/reviews/public/file` e blobs gigantes removidos; `/reviews/media` é o único mecanismo de bytes de prévia.

## Operação e QA

- Em D1, a propriedade de cada ACL gerenciada continua distinta de cada uso; fechar um convite não remove acesso compartilhado por outra revisão.
- CI da API verifica migração, versionamento, autoria, controle de participante, expiração, rotação e permissões.
- CI frontend e E2E manual de aprovações verificam convidados, tema claro/escuro, zoom, troca de arquivos e recuperação de falhas.
- Métricas de streaming devem acompanhar volume transferido, requisições Range, respostas 401/403/404/416/502 e latência, sem registrar tokens ou dados de participantes.
- Isolamento por cópias privadas ou transcodificação de codecs não são parte desta migração; exigem fluxo próprio para controlar quota, arquivo duplicado, retenção, autorização e custo. Não prometer essas funcionalidades enquanto não implementadas.
