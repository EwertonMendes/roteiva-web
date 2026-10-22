# Arquitetura do Roteiva — MVP SaaS

**Atualizado em 16/10/2026. Fundação Firebase DEV IMPLEMENTADA na PR #6; publicação DEV e testes automatizados validados; Google real e persistência conferidos em uma conta; segunda conta e dispositivos ainda em andamento. Fundação Worker/D1 DEV na PR #15; biblioteca Drive e demais fases continuam PLANEJADAS.**

Esta é a fonte de verdade sobre **como o sistema deverá funcionar**. O acompanhamento do que já foi entregue fica no [roadmap](MVP-ROADMAP.md); instruções operacionais em [desenvolvimento](DEVELOPMENT.md). Mudanças de arquitetura e decisões novas devem atualizar este arquivo **no mesmo PR**, conforme [AGENTS.md](../AGENTS.md).

## 1. Objetivo e princípios

O Roteiva é um SaaS para profissionais audiovisuais que precisam gerir clientes, produções, prazos, receitas/despesas, arquivos, versões e revisões.

**Princípios:** custo mínimo para os primeiros 2–10 usuários; serviços remotos com franquias gratuitas; segurança e isolamento entre contas por padrão; arquivos grandes no Drive do proprietário; operações privilegiadas no backend; frontend responsivo e acessível; simplicidade antes de funcionalidades avançadas; crescimento sem reescrita desnecessária.

Não confundir **R$ 0 enquanto dentro da franquia** com infraestrutura ilimitada e gratuita. Monitorar cotas e impor limites de uso antes de expandir. Nenhum computador pessoal, túnel ou servidor caseiro é parte da arquitetura.

## 2. Estado atual versus destino

| Área | Estado DEV na PR #6 | Futuro |
|---|---|---|
| UI | React 19 + Vite 8 + TypeScript; telas preservadas | Sem SSR/Next/Vinext |
| Hospedagem | Hosting ativo no Spark em roteiva-web-dev; Pages continua demo | PROD fora deste escopo |
| Login | Firebase Auth Google, sessão, logout e proteção | Login não concede Drive |
| Dados | Firestore Standard nativo em São Paulo, escopo por UID | Workspaces compartilhados exigem nova modelagem/regras |
| Segurança | Regras deny-by-default, contratos/revisões e testes A/B nos emuladores | Revisão adicional antes de piloto público |
| API/Drive | Fundação TypeScript e contratos na PR #15; recursos DEV separados, OAuth desabilitado até PoC | Biblioteca e upload continuam planejados |
| Revisão | Página explicativa protegida no DEV | Convites e ACL de mídia futuros |
| Cobrança | Spark, sem Blaze ou serviços pagos | Sem implementação de planos |

**Decisão de migração:** por solicitação expressa, Next.js/Vinext e o adaptador de renderização foram removidos na [PR #5](https://github.com/EwertonMendes/roteiva-web/pull/5). A interface existente foi mantida em React/Vite, com entrada única em `src/`, para funcionar no **Firebase Hosting estático**. O banco D1 antigo já foi descartado; o Firestore começará com entidades modeladas do zero. A demonstração ainda usa estado local agregado e não migrará dados automaticamente entre domínios.

## 3. Desenho lógico

```text
Navegador (React / Vite / TypeScript)  -- Firebase Hosting
  |          |                         |
  |          | Firebase Authentication | Firebase ID Token
  |          v                         v
  |     Cloud Firestore          Cloudflare Worker (API segura)
  |     - workspaces             - valida Firebase ID Token
  |     - projetos / clientes    - autorização por workspace
  |     - agenda / financeiro    - OAuth Drive (callback e refresh)
  |     - metadados / revisões   - revogação e gestão das conexões
  |          ^                         |
  |          | Security Rules          v
  |                               Cloudflare D1
  |                               - tokens cifrados
  |                               - metadados OAuth mínimos
  |
  +---- upload e visualização autorizados ---> Google Drive do usuário
         (sem transportar o vídeo pelo Worker; validar CORS/fluxo no PoC)
```

O Worker é uma camada de operações privilegiadas, não deve virar proxy de streaming de arquivos grandes. O Firestore é o sistema de registro do negócio; o D1 não replica clientes/projetos e não substitui regras Firestore.

## 4. Frontend

Um frontend em `src/`; modo explícito `VITE_APP_MODE` seleciona demo ou Firebase, sem detecção por domínio. Build Firebase usa `.env.firebase`, Pages usa `.env.demo`. O runtime aceita somente roteiva-web-dev; emuladores exigem demo-roteiva.

`features/auth` inicializa persistência e observa onAuthStateChanged. ProtectedRoute espera sessão antes de montar o workspace; troca de UID desmonta o estado privado. Popup parte diretamente do clique após preparar persistência. Sem scopes Drive ou fallback de redirecionamento não validado.

`FirebaseWorkspace` carrega e confirma gravações do servidor; o codec adapta as telas preservadas. Erros bloqueiam edição e oferecem recuperar a nuvem, descartando rascunhos não confirmados. Tema, Ubuntu, animações e responsividade existentes são preservados. Demo mantém localStorage, sem inicializar Firebase nem importar dados antigos. Dados de negócio privados usam cache em memória por padrão. Cache persistente oficial Firestore (IndexedDB, múltiplas abas) pode ser ativado explicitamente em Configurações, com alerta sobre dados privados no dispositivo e apagamento na desativação/logout. Sem consentimento, nenhum cache Firestore persistente é criado.

## 5. Identidade e autorização

**Decisão tomada — Solo:** dados privados em `users/{uid}` e subcoleções. Security Rules exigem request.auth.uid igual ao UID do path; ownerUid é idêntico e imutável. Perfil é privado; nenhum campo de role/plano/admin é aceito. URL/localStorage/estado React não concedem acesso a outra conta.

Google é o único provedor. Domínios: dois Firebase DEV e localhost. SDK público em Vite não é credencial administrativa. Sem Admin SDK no browser. Sessão persistida pelo Firebase Auth; dados de negócio em memória são descartados no logout.

Regras validam create e update: campos permitidos/obrigatórios, tipos, limites, enumerações, referências getAfter na mesma conta, timestamps de servidor e revisão sequencial. Negação por padrão. Excluir perfil é proibido até existir limpeza completa de filhos. Testes A/B e limites constam do roadmap; compartilhamento/equipes/revisores futuros exigem novo modelo, regras e migração explícita.

## 6. Banco de negócio — Cloud Firestore

**Decisão aprovada:** roteiva-web-dev, banco (default), edição Standard/nativo, região permanente southamerica-east1, Spark. Inicialização Production Mode deny-all. Sem backups/TTL/PITR pagos, Functions ou bucket Storage.

```text
users/{uid}                    perfil privado: displayName, email, photoURL
  preferences/ui               tema light/dark
  clients/{id}                 contato, pacote e monthlyFeeCents
  projects/{id}                briefing, cliente, status, dueDate
  tasks/{id}                   projectId, title, done
  deliveries/{id}              clientId, title, month, done
  events/{id}                  date, time, endTime, vínculos
  financeEntries/{id}          amountCents, date, kind, status, vínculos
  activities/{uuid}            histórico privado de conveniência
```

Contratos em domain/workspace.ts e data/workspace-codec.ts; persistência em data/firestore-workspace.ts. Documentos têm ownerUid, schemaVersion=1, revision e createdAt/updatedAt de servidor. IDs numéricos da UI usam 48 bits aleatórios; histórico usa UUID. Tipos/status são enums existentes: sem criar coleção de categorias que as telas ainda não usam.

Moeda em centavos inteiros. Datas civis YYYY-MM-DD, mês YYYY-MM e horários HH:mm; regras validam dias reais e ano bissexto. Datas da agenda não viram timestamps UTC. activities não é auditoria inviolável.

Carregamento por rota: `workspace-scopes.ts` define domínios completos necessários. A Visão Geral consulta atividades, agenda de três meses e até quatro compromissos posteriores, além de um pequeno lote dos projetos recentes (até quatro) com as tarefas correspondentes; contagem por etapa, clientes e valores a receber usam agregações, exceto projetos cujo primeiro lote cobre o total, que reutilizam o resultado sem quatro consultas adicionais. A listagem de Projetos usa **cursor no Firestore** com páginas de até 24, filtro de status no servidor e consulta de tarefas por IDs da página. A lista de Clientes também usa cursor de 24, com total e contagem de recorrentes no servidor; carrega projetos completos separadamente para os contadores por cliente e só carrega entregas no detalhe. Buscas textuais em Projetos/Clientes solicitam o conjunto completo para não mostrar resultados incompletos. A abertura de detalhes busca os domínios integrais necessários, sempre após a confirmação de mutações pendentes. Financeiro utiliza uma consulta limitada ao mês selecionado, sem puxar outros anos e meses, enquanto o gráfico anual utiliza doze agregações de soma (ou uma leitura completa para até 40 documentos); ao alterar um lançamento, apenas os meses envolvidos são reconsultados quando possível. Cliente e status continuam corretos porque o conjunto do mês é completo. A Agenda consulta a janela da grade de três meses e os quatro próximos compromissos além dela. Esses domínios permanecem **parciais** para a lógica de cache e escrita, e a exportação JSON força a leitura completa. A tabela financeira não possui paginação visual de 24 itens dentro de um mesmo mês: a unidade de otimização é o período, preservando cálculos, CSV, vínculos e filtros. Configurações não baixa coleções de negócio em link direto; Biblioteca carrega apenas projetos para o seletor; exportação busca todos os domínios. Páginas parciais jamais são marcadas como domínio completo, nem podem causar exclusões implícitas. Com consentimento, cache de documentos pode ser reutilizado após verificar `users/{uid}/sync/state`: revisões independentes e contagens das sete coleções. O cache só é aceito se a versão armazenada corresponder à versão remota e se a contagem de documentos disponíveis for completa; caso contrário consulta o servidor. O stamp é criado após o registro inicial com contagens zeradas. Para contas legadas sem stamp, contagens são obtidas por agregações antes da inicialização transacional, sem download completo do histórico. Mutações atualizam os contadores e revisões na mesma transação. Sem listeners globais: no retorno à aba, depois de um intervalo mínimo, a aplicação verifica o estado e pede recarga explícita se houve alteração remota. Firebase usa comandos tipados (`src/data/firestore-commands.ts`) emitidos diretamente pelas ações (cliente, projeto, tarefa, entrega, financeiro, agenda, atividade), sem salvar snapshots a partir de efeitos de renderização; apenas a demonstração usa o snapshot localStorage. Os comandos consultam revisões, gravam documentos alterados e atualizam `sync/state` na **mesma transação**, rejeitando conflito. O método antigo `save(workspace)` permanece apenas para compatibilidade e testes, sem uso na UI Firebase. Nomes denormalizados de vínculos são atualizados junto da edição do cliente. Falhas de rede/permissão bloqueiam novas edições e permitem recarregar a nuvem. Sem fila offline ou migração automática.

Sem índices compostos exigidos na fase atual: consultas ordenam por documentId. Índices por filtros e agregações dependem da migração futura para consultas por tela. Tarefas e entregas são documentos independentes. Exportação JSON/CSV preservada, sem mídia. Exclusões de lançamento/agenda são pontuais; exclusão de conta e limpeza completa continuam planejadas.

## 7. Backend — Cloudflare Workers (fundação DEV, PR #15)

Worker TypeScript com rotas mínimas de **operação privilegiada**, não CRUD indiscriminado do que as Firestore Rules podem proteger:

| Contrato lógico (nomes provisórios) | Objetivo |
|---|---|
| `GET /health` | Saúde sem dados privados |
| `POST /oauth/drive/start` | Validar usuário e iniciar OAuth com state/PKCE quando aplicável |
| `GET /oauth/drive/launch` | Consumir ticket de uso único em navegação principal; definir cookie HttpOnly SameSite=Lax e redirecionar ao Google |
| `GET /oauth/drive/callback` | Conferir state, trocar code, identificar Google account, cifrar refresh token |
| `GET /integrations/drive` | Estado da conexão do workspace autenticado |
| `POST /integrations/drive/disconnect` | Revogar autorização, remover token e atualizar estado |
| `POST /drive/uploads/init` | Autorizar owner/projeto e iniciar sessão de upload resumable (PoC obrigatório) |
| `POST /drive/share` | Conceder/revogar permissão no Drive sob ACL explícita |
| `POST /entitlements/*` | Alterações de plano apenas por processo administrativo seguro (futuro) |

Nas PRs #15–#17, `/health`, `/oauth/drive/start`, `/oauth/drive/launch`, `/oauth/drive/callback`, `/integrations/drive` e `/integrations/drive/:connectionId/{about,metadata,disconnect}` possuem implementação de fundação/PoC; publicação e evidências constam no roadmap. Upload/share/entitlements permanecem **PLANEJADOS**. Incluir verificação de propriedade dos arquivos antes de compartilhar, rate limit, validação de entrada, CORS por allowlist DEV/PROD, logs estruturados sem segredos, tratamento de retries e idempotência. OAuth callback precisa de proteção contra CSRF, replay e vinculação ao usuário que iniciou o fluxo. A depender do fluxo, usar cookie seguro HttpOnly/SameSite e armazenamento temporário de state com expiração; **nunca confiar no UID vindo do retorno OAuth sem verificar o state**.

**Secrets do Worker:** OAuth client secret, chaves AES-GCM com versionamento, demais credenciais. Config pública do Firebase não é segredo, mas regras continuam obrigatórias. Sem service account JSON em código ou repo. CI/CD: segredo por ambiente, deploy DEV separado de PROD.

## 8. D1 e proteção de tokens (fundação DEV, PR #15)

D1 é o banco SQL serverless vinculado ao Worker e serve **somente à infraestrutura privada**, principalmente OAuth; não é armazenamento de mídia.

Modelo indicativo: `drive_connections(workspace_id, owner_uid, google_account_id, google_email, encrypted_refresh_token, iv, key_version, scopes, folder_id, status, created_at, updated_at)`. Índice/constraint para impedir conexão cruzada; permitir reconectar e substituir token de forma segura. **Jamais registrar um token legível** no D1, logs, Firestore, URLs ou no frontend.

- Cifrar refresh token com criptografia autenticada (AES-GCM) usando chave em Worker Secrets; nonce aleatório único, versão de chave e AAD que vincule conta/workspace.
- Renovar access tokens no Worker quando necessário, lidar com rotação e `invalid_grant` (reconexão). Access tokens de curta duração podem existir temporariamente em memória do Worker.
- Provar isolamento em testes com dois usuários e duas contas Drive.
- Definir política de retenção, revogação, exclusão de conta, rotação de chaves e recuperação operacional antes do piloto externo.
- Não criar caminho público que devolva refresh tokens. Se for inevitável delegar um **access token temporário** para o navegador fazer upload, restringir escopo/uso, manter só em memória e explicitar o risco; preferir sessão resumable limitada se validada.

## 9. Google Drive — arquivos do próprio usuário (PLANEJADO)

**Direção:** usar OAuth incremental com `https://www.googleapis.com/auth/drive.file`, evitar `drive` amplo/restrito. Usuário autoriza individualmente e mantém a titularidade, capacidade e custos de seu Drive. Integração deve respeitar escopos, cotas de API, limites por conta, políticas corporativas e desconexão. Google Picker para selecionar arquivos já existentes explicitamente; não presumir visibilidade geral do Drive.

**Fluxo-alvo:**
1. Profissional entra no Roteiva via Firebase.
2. Inicia **Conectar Drive**; Worker prepara OAuth e vincula transação ao Firebase UID/workspace.
3. Google devolve código ao Worker; Worker troca, cifra refresh token e registra conexão em D1.
4. Worker cria/localiza pasta gerenciada **Roteiva** no Drive autorizado, respeitando `drive.file`, e grava somente `folderId`/metadados de referência.
5. Para cada projeto, criar pastas/subpastas quando necessário, com nomenclatura previsível e **IDs de arquivos como fonte de verdade** (não caminho textual).
6. Upload do navegador diretamente ao Drive, com capacidade resumable, retries e progresso. Metadados de versão só são confirmados no Firestore após upload concluído e verificado.
7. Ao trocar versão, criar novo arquivo/referência preservando histórico; não substituir silenciosamente arquivos sem consentimento.
8. Ao desconectar: cessar acesso, revogar token quando cabível; os arquivos permanecem no Drive da pessoa. Informar impacto em revisões/links.

### Ponto de validação obrigatório — uploads grandes

**Não presumir** que a sessão resumable criada no servidor será consumível pelo browser em todas as combinações de CORS, `Origin`, headers e Google Drive API. Implementar **PoC antes de migrar a biblioteca**, comparando:
- Worker cria sessão OAuth e retorna URL de upload restrita ao usuário; browser envia chunks diretamente ao Drive;
- Browser recebe **access token curto/drive.file**, em memória, e cria/usa sessão diretamente pelo SDK/API;
- outras alternativas suportadas pela API, **sem fazer proxy de vídeos grandes via Worker**.

Testar vídeos grandes (inclusive acima de 250 MB), rede instável, reenvio, retry, cancelamento, expiração de acesso, quotas, Safari e mobile. URLs de sessão são credenciais de capacidade e não devem ir para log ou persistência pública. Se o upload direto não passar na PoC, **revisar o projeto antes de anunciar o recurso**.

## 10. Revisão e compartilhamento de mídia — PR #55 (implementação em validação)

A especificação operacional completa está em [REVIEWS-MVP.md](REVIEWS-MVP.md). A infraestrutura de arquivos continua sendo o Google Drive individual. Para comentários no segundo real do vídeo, a PR #56 introduz um relay de vídeo **somente para leitura e por Range limitada** no Worker, com token curto vinculado à revisão e revalidação D1; se indisponível, permanece o iframe Google Drive como fallback. Não há armazenamento de mídias no Roteiva. O Firestore guarda exclusivamente clientes/projetos/pastas privadas do proprietário; o D1 contém as solicitações e versões de aprovação, comentários/decisões e estado das concessões de permissão necessárias ao portal público.

A rota `/review/{capability}` não usa o ProtectedRoute: token aleatório de 256 bits, hash para busca e cópia cifrada por AES-GCM em D1. O próprio Worker valida links, expiração, comentários e decisões; não existe regra Firestore pública. Dois modos selecionáveis: convite por link (arquivos explicitamente autorizados com ACL `anyone/reader` no Drive) e convite por e-mail Google (claim `email_verified` e `google.com` verificados pelo backend e ACL individual). O modo restrito rejeita arquivos previamente públicos ou com permissão de domínio; não altera ACLs preexistentes concedidas pelo dono.

Projetos, clientes, vínculo de pastas e descendência do arquivo são verificados pelo backend, sem confiar em IDs vindos do navegador. A criação de permissão ocorre por arquivo e só publica a solicitação quando todos os compartilhamentos são confirmados. Versionamento preserva histórico, revoga a ACL da versão antiga e impede revisão durante mudanças parciais. Expiração, encerramento, desconexão e exclusão da conta devem coordenar as revogações antes de encerrar a credencial Google. Falha externa mantém estado pendente, sem simular sucesso.

**Limite de garantia:** link público do Drive concede acesso de leitura direto pelo Google até remoção efetiva da ACL; links diretos, downloads anteriores e permissões externas criadas pelo dono não podem ser retroativamente desfeitos pelo portal. A identificação textual de um revisor sem login não é assinatura legal. Previews dependem de suporte/conta/cookies do Google, com fallback para abrir diretamente no Drive.

**Decisão tomada — coordenação de ACL (PR #55, 20/10/2026):** migration aditiva `0014_review_grant_coordination.sql` reserva cada Drive file ID globalmente para uma revisão/versão até revogação confirmada. Uma segunda revisão precisa aguardar ou usar outra cópia; isso evita adotar/revogar a ACL de outro convite, inclusive com conexões diferentes. Uma lease por arquivo de 120s serializa as chamadas Google limitadas por timeout, permitindo retomada após interrupção. Encerramento bloqueia o portal primeiro e não conclui enquanto uma concessão estiver em andamento; o ID conhecido é persistido antes da compensação, e falha no DELETE mantém estado recuperável. Cron também retoma `closing` antes do vencimento. A migração interrompe em caso de concessões históricas conflitantes; não resolver removendo permissões preexistentes.

POSTs públicos exigem a versão efetivamente exibida ao cliente; a escrita ainda confere versão, token, validade e estado no D1. Respostas públicas omitem IDs de cliente/projeto e e-mail do destinatário. Nova versão usa identificador de transição para que só a operação vencedora insira os arquivos na mesma transação. Google restrito rejeita ACL de grupo ou de outra pessoa além do proprietário/conexão e destinatário, incluindo permissões herdadas retornadas pelo Drive. ACLs do destinatário preexistentes permanecem externas e não são removidas.

A coordenação cobre operações do Roteiva. Edições simultâneas de ACL feitas diretamente no Google por outros aplicativos/usuários não participam da lease; exigem reauditoria, especialmente após resposta perdida. O Google [não suporta mutações concorrentes de permissão no mesmo arquivo](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create). Não prometer isolamento contra o proprietário alterar o Drive fora do produto.

## 11. Assinaturas e autorização de planos

No piloto: plano ativado **administrativamente**, sem cobrança automática. Limites por plano devem ser verificados por autoridade confiável (Worker/claims controladas), **nunca** editáveis pelo próprio usuário. Firestore Rules precisam impedir adulteração de plano/papel. Não implementar checkout, webhooks ou colaboração avançada antes de validar fluxo básico e demanda.

Proposta comercial ainda exploratória: gratuito limitado, Solo e Studio. Não documentar preços como contrato comercial. Sem cota de armazenamento vendida pelo Roteiva, pois pertence ao Google Drive do assinante.

## 12. Cotas, observabilidade e plano gratuito

O DEV mantém Spark. Firestore Standard tem franquias de 50.000 leituras, 20.000 escritas e 20.000 exclusões por dia, 1 GiB armazenado e 10 GiB de saída/mês. Hosting estático oferece 10 GB de conteúdo e 10 GB de transferência/mês. Limites e comportamento no teto estão em [DEVELOPMENT.md](DEVELOPMENT.md). Recursos DEV e limites da fundação Worker/D1 estão registrados em DEVELOPMENT.md; a PoC funcional Drive ainda precisa ser concluída. **2–10 usuários é cenário estimado, não garantia de custo fixo.**

Criar dashboards de erro/consumo, alertas operacionais quando disponíveis sem custo, limites defensivos por usuário, proteção a abuso/rate limiting e revisões periódicas. Se ficar perto das franquias, reduzir leituras e avaliar upgrade baseado em receita. No Worker, habilitar **fail closed** para rotas de segurança.

Referências oficiais:
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Firestore pricing](https://firebase.google.com/docs/firestore/pricing)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Drive scopes e drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google OAuth web-server/offline access](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Drive resumable upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

## 13. Ambientes, testes e entrega

Ambientes separados DEV e PROD, com Firebase, Worker, D1, OAuth client, consent screen/origens e segredos próprios. A demo no Pages continua sendo localStorage e não mistura dados de produção. Produção exige domínio/origens autorizadas, termos e privacidade, exportação/exclusão de dados, regras de acesso testadas, fluxo de restauração/reconexão e monitoramento.

Teste mínimo: unitários de domínio, Security Rules via Firebase Emulator, fluxos Firebase Auth, verificação de ID token no Worker, testes OAuth/PKCE/state, recuperação de refresh token, usuários A/B isolados, autorização de convites, upload resumable/retry, revisão e revogação de arquivo, mobile e contrastes/teclado.

Workflow recomendado: feature branch → PR → CI → preview DEV → teste manual → merge → deploy PROD controlado, com rollback e documentação atualizada.

## 14. Decisões e riscos em aberto

| Tema | Estado | Caminho |
|---|---|---|
| Frontend React/Vite, Firebase Hosting/Auth/Firestore | **IMPLEMENTADO na PR #6; automação validada, QA real pendente** | Fundação UID Solo; evidências no roadmap |
| Worker + D1 para OAuth/tokens | **Direção definida, pendente de PoC** | Testar WebCrypto/JWT, OAuth e limites Free |
| Drive próprio com `drive.file` | **Direção definida, pendente de PoC** | OAuth offline + Picker + pasta gerenciada |
| Técnica de upload sem proxy | **EM ABERTO** | Testar sessão resumable, token curto, CORS e browsers |
| Organização das pastas | **Proposta:** pasta gerenciada com importação explícita | Validar UX com piloto |
| Acesso de clientes para revisão | **Proposta:** login Google + convite privado | Validar com usuário real e Drive ACL |
| Player dentro do Roteiva | **EM ABERTO** | Primeiro usar preview/link Drive + timestamp manual |
| Cobrança | **Proposta:** controle manual de plano no MVP | Automatizar após faturamento |
| Times multiusuário | **Fora do escopo inicial** | Planejar depois do MVP Solo |
| Licença/direitos sobre código BRBET | **VERIFICAÇÃO NECESSÁRIA** | Não copiar implementação antiga sem confirmação |

Mudanças de uma decisão para **confirmada**, **validada** ou **descartada** precisam citar evidência no PR e atualizar também o [roadmap](MVP-ROADMAP.md).

## 15. Entrega DEV e decisões de infraestrutura

A migração React/Vite foi preservada. Auditoria anterior às alterações em [DEVELOPMENT.md](DEVELOPMENT.md). Hosting já estava ativo com release 043ce6; textos antigos que diziam não publicado foram corrigidos.

CI valida ambos builds, regras e browser nos emuladores. Deploy DEV após CI verde da master, checkout do SHA validado e projeto fixo. Dispatch manual executa testes novamente. Secret preexistente protegido no Actions. Papéis de regras/índices e Service Usage Viewer autorizados pelo proprietário e concedidos somente no DEV; WIF é evolução futura, sem pools/credenciais extras neste escopo.

Limitações: sem atualização em tempo real entre abas; conflitos por documento e reload explícito; sem fila offline privada. OAuth Google real, segunda conta e Safari/iOS dependem evidência registrada no roadmap. A fundação Worker/D1 está na PR #15; a biblioteca Drive continua PLANEJADA.


## 16. Primeiro acesso e registro consciente (PR #9)

O primeiro login no Firebase Auth Google pode criar uma identidade no Firebase Authentication, **mas isso não constitui cadastro no Roteiva**. A aplicação consulta `users/{uid}` no Firestore após autenticar, sem criar/escrever um perfil durante login. `RegistrationGate` trata separadamente os estados de consulta, erro, conta existente, conta não cadastrada e cadastro em andamento. Erros de rede **não são interpretados como ausência de perfil**.

- **Conta existente:** perfil antigo (`displayName`, `email`, `photoURL`) ou novo é reconhecido pela existência do documento. Sem atualização automática da conta, sem refazer onboarding e sem sobrescrever cadastros/lançamentos atuais. O nome registrado aparece na interface.
- **Conta nova:** botão explícito `Criar conta` na tela de acesso, login Google, formulário curto, confirmação específica de que informações serão armazenadas no Firebase DEV e `registerProfile` em transação (cria uma vez; nunca sobrescreve). Na opção `Entrar` para UID desconhecido, a tela explica que ainda não há conta e pergunta se deseja prosseguir com o registro; sair não cria perfil.
- **Contrato novo do perfil:** `studioName` (até 120 caracteres, opcional), `professionalType` (`freelancer|studio|producer|other`), `registrationCompletedAt`, `dataAcknowledgedAt` e campos básicos anteriores. Os timestamps de primeiro registro são imutáveis. Regras exigem dados completos + `request.time` para novas criações. As regras aceitam documentos antigos sem esses campos **somente em leituras e atualizações**, preservando perfis existentes.
- **Dados de negócio:** as regras já exigem `member(uid)` (documento de perfil existente) para subcoleções. A autenticação sem confirmação de registro não cria documentos; a proteção de cliente se apoia em regras Firestore, não em verificações visuais. Qualquer cliente malicioso ainda pode enviar diretamente um perfil novo válido através do SDK: esta separação é consentimento/UX, não prova criptográfica de um clique no formulário.
- **Transparência DEV:** o texto do checkbox é um reconhecimento específico do uso de dados do ambiente de testes; **não equivale** à aceitação de Termos de Uso/Política de Privacidade de produção. Documentos jurídicos definitivos e processo formal de aceite permanecem pendentes antes de cadastro público.

Firebase Authentication e Firestore só operam no modo `firebase`. Demo Pages mantém a persistência `localStorage` e o mesmo frontend de gestão. Validar em CI auth emulado, regras de UID, novos/antigos perfis e navegador mobile/desktop; OAuth real e dispositivo físico não são substituídos pelos emuladores.

## 17. Perfil editável e identificação do estúdio (PR #11)

O contexto `RegistrationGate` já consulta o perfil proprietário `users/{uid}`. Agora propaga a leitura completa (`displayName`, `studioName`, `professionalType`, `revision`, indicador de conta antiga) e uma operação `saveProfile` para o dashboard, sem novo listener nem duplicar documentos. `FirebaseWorkspace` não grava nome, foto ou e-mail a cada login.

`FirestoreWorkspace.saveProfile` recebe mudanças validadas e a revisão esperada. Uma transação lê o documento atual, compara `revision`, escreve somente `displayName`, `studioName`, `professionalType`, `revision+1`, `updatedAt`, ou rejeita o conflito. **Não altera** `ownerUid`, `schemaVersion`, `createdAt`, e-mail/foto, `registrationCompletedAt` nem `dataAcknowledgedAt`. Regras impõem proprietário e imutabilidade de identidade Google. Perfis anteriores ao onboarding permanecem "legacy": podem acrescentar estúdio e atuação em par, sem alterar o estado original nem simular um novo aceite; perfis atuais preservam timestamps obrigatórios.

`src/features/settings/SettingsPage.tsx` reutiliza o tema e `WorkspaceTools` existente. A navegação `Configurações` e o nome do estúdio no topo usam o mesmo componente React para desktop/mobile. Nome do estúdio vazio -> rótulo alternativo `Roteiva Studio`. O modo Pages apresenta a seção sem permitir alterar perfil remoto. A exportação JSON carrega explicitamente os domínios que faltam antes de gerar o arquivo, sem aceitar um workspace parcial como cópia completa. A eliminação integral das subcoleções e da identidade Auth permanece separada e pendente.

A experiência não oferece botão de exclusão inoperante nem modifica a estrutura das coleções de projeto. Evidência de conclusão: CI Firestore Emulator (UID A/B, perfis antigos e novos, concorrência) e Playwright Chromium desktop/mobile, além de deploy DEV após merge.

## 18. Rotas de navegação e URLs persistentes (PR #12)

A UI única React/Vite não usa SSR nem Next. `src/lib/workspace-routing.ts` mantém uma tabela tipada de rotas, funções de parsing, canonicalização e geração de URLs, testadas sem navegador. `DashboardClient` inicializa tela/detalhe com a URL atual e sincroniza navegação via `window.history.pushState` sem reload, ouvindo `popstate` (e `hashchange` no Pages) para Voltar/Avançar. Eventos de navegação passam pelo mesmo caminho central, inclusive cartões, atalhos, menu móvel, detalhes e criação de projeto. Projeto e cliente devem **existir nos dados daquela sessão autenticada** antes de abrir a tela de detalhes; URL para ID ausente volta à listagem por `replaceState`.

**Firebase DEV (URLs limpas, SPA rewrite):** `/` painel, `/projetos`, `/projetos/:id`, `/clientes`, `/clientes/:id`, `/aprovacoes`, `/financeiro`, `/calendario`, `/biblioteca`, `/configuracoes`. `/review` é rota independente existente de revisão indisponível, preservada sob a camada de autenticação. O `firebase.json` já possui rewrite `**` → `/index.html`; nenhum serviço adicional é necessário. Uma pessoa não autenticada pode preservar a URL desejada durante o login, mas não vê dados antes do Auth/Firestore.

**GitHub Pages (hash routing):** `/roteiva-web/#/projetos` e `/roteiva-web/#/projetos/:id`, etc. Necessário porque o Pages não responde a caminhos SPA internos com fallback HTTP 200; não copiar `index.html` para uma página de erro nem introduzir reescritas inoperantes. O frontend permanece o mesmo, e o modo é escolhido apenas por `VITE_APP_MODE`, não pelo domínio.

**Proteção de dados:** URL não representa autorização; documentos são lidos exclusivamente do `users/{uid}` do Firebase Auth e as regras já negam usuários diferentes. No logout explícito, a URL de detalhe é substituída pelo caminho inicial para não deixar um identificador privado na barra de endereço. Recuperação de sessão restaura o mesmo caminho enquanto houver acesso. Link para ID inválido/desconhecido não deve expor conteúdo de outras contas nem inventar um projeto.

**QA exigido:** cada seção, F5 e abertura direta, Voltar/Avançar, detalhes existentes/inexistentes, login com link direto, conta A/B, `/review`, Pages com `#/...`, desktop e mobile. Sem migração de dados, novos serviços ou dependências de roteamento.

## Fundação de integração DEV — PR #15 (17/10/2026)

**Decisão tomada:** API independente em `api/`, com npm/lockfile próprios; frontend PNPM, UI, regras Firestore e deploys existentes preservados. Firebase continua identificando usuários em `roteiva-web-dev`. O OAuth Drive usa o novo projeto **roteiva-drive-dev** (479738001561): a tela OAuth do Firebase existente estava Em produção; uma tela separada em Testing evita alterar o login atual. Não existe PROD nesta entrega.

Cloudflare: Worker `roteiva-api-dev`, D1 `roteiva-drive-dev`, binding `DB`, migration `0001_oauth.sql`. Domínio: https://roteiva-api-dev.ewertonmendes9.workers.dev. A palavra Production no dashboard Cloudflare identifica a versão ativa **desse Worker DEV**, não um ambiente Roteiva PROD.

`jose` valida assinatura RS256 por JWKS oficial Firebase, issuer, audience, sub, iat, exp e auth_time. Não aceita UID enviado pelo cliente nem tokens de emulador. **Limite:** não consulta revogação/disable em Admin API a cada pedido; um ID token previamente emitido pode permanecer válido até expirar. Dados de negócio e autorização de projetos permanecem no Firestore; contratos presentes são exclusivamente do próprio UID, sem workspace compartilhado.

OAuth é Authorization Code confidencial, offline, escopo `openid email drive.file`, PKCE S256, nonce OIDC e state aleatório de 256 bits armazenado como hash com TTL de dez minutos e consumo atômico DELETE RETURNING. O início autenticado cria ticket efêmero de uso único e retorna `launchUrl`; a navegação top-level ao Worker consome o ticket antes do redirect ao Google e instala cookie `__Host-`, HttpOnly, Secure, SameSite=Lax. O navegador não precisa aceitar cookies de terceiros para essa etapa. Callback não confia em UID/conta vindos da URL. Verifier também cifrado; identidade Google obtida de ID token validado contra issuer/audience/nonce e e-mail verificado. Não agrega escopos amplos. Estado consumido não pode ser reutilizado mesmo se a troca de código falhar. Cinco inícios por UID por dez minutos; rate limiter de plataforma adicional por UID e agregado, local ao ponto Cloudflare, **não** uma quota global rígida.

**Hipótese ainda sujeita a QA real:** o fluxo de navegação top-level com cookie SameSite=Lax deve funcionar em Chrome/Safari/mobile, mas ainda não houve consentimento real. O frontend deve navegar para `launchUrl`, nunca chamar essa rota por fetch nem em iframe. O ticket dura no máximo dez minutos e só pode ser consumido uma vez. Nunca armazenar o ticket ou URL em logs; não remover a vinculação state+cookie para contornar erros. Na PR #17, `OAUTH_ENABLED=true` somente no DEV Google Testing para permitir consentimento real da conta de teste; essa ativação não equivale a validação. Se houver falha de segurança/QA, retornar imediatamente a `false` no DEV e republicar.

AES-256-GCM usa IV aleatório de 96 bits, chave no Secret `TOKEN_KEYS` e envelope com versão, IV e ciphertext/tag; AAD inclui app, ambiente, UID, conta e finalidade. Só ciphertext entra no D1; o cache de access token também é cifrado, com expiração e versão, conforme a seção de otimização abaixo. Renovação não faz retry cego: invalid_grant apaga o ciphertext e marca reconexão; erros transitórios preservam credencial; refresh token novo é cifrado e gravado por comparação de revisão. Revogação bloqueia refresh antes da chamada Google; falhas mantêm revocation_pending para nova tentativa explícita, arquivos permanecem no Drive. **Pendente antes de piloto:** reconciliação de refresh/desconexão concorrentes em teste real, limpeza periódica de estados sem tráfego, retenção máxima de revogação pendente e recuperação operacional de chaves.

Conexões têm constraint `UNIQUE(owner_uid,google_account_id)`; mesmo Google pode ser autorizado separadamente por dois UIDs, sem compartilhar credenciais. Metadados e desconexão exigem identidade e consulta por UID+connectionId. Não há ACL compartilhada, listagem recursiva, upload, player ou biblioteca.

**Limite de drive.file:** selecionar uma pasta não autoriza automaticamente todos os arquivos preexistentes, subpastas ou descendentes. Múltiplas pastas exigem referências por ID e seleção/autorização dos arquivos necessários com Picker. A futura modelagem pasta/projeto é Firestore; não adicionar um único folder_id à conexão como se representasse toda a biblioteca. Qualquer mudança para drive.readonly/drive exige decisão explícita sobre escopos restritos, verificação e eventual avaliação de segurança.

### Ajuste do callback OAuth — tratamento granular do consentimento (outubro/2026)

O callback não confunde ausência de `scope` na resposta de troca de código com uma negativa explícita. Se `scope` vier preenchido, precisa incluir `drive.file`; em todos os casos a API `Drive about.get` comprova o acesso antes de armazenar credencial offline. `refresh_token` ausente é aceito **somente** quando já existe uma conexão `connected` com ciphertext válido da mesma identidade Firebase e da mesma conta Google; em primeiro acesso gera `offline_access_unavailable`, sem persistir sessão temporária. Contas em revogação não são restauradas silenciosamente. Erros após validar state/cookie são devolvidos por redirect seguro à Biblioteca, sem resposta OAuth bruta nem tokens na URL. Esta mudança exige consentimento real e QA para comprovar funcionamento ponta a ponta.

### Biblioteca Drive: conexão única e pastas por projeto (17/10/2026)

A conexão OAuth para DEV solicita em **um único consentimento** `openid email drive.file drive.readonly`. Isso dá leitura ampla de arquivos existentes; o Roteiva **exibe apenas pastas associadas** na Biblioteca por escolha do usuário, mas a autorização Google subjacente não é limitada por pasta. O escopo `drive.readonly` é restrito e exige revisão de exigências Google, verificação e possível avaliação de segurança antes de uso público. Usuários que conectaram na PoC de `drive.file` precisam confirmar uma única atualização de consentimento quando clicarem **Vincular pastas**; após isso não há segunda etapa de autorização.

A UI preserva o projeto selecionado em `sessionStorage` somente como intenção de navegação (nunca tokens), realiza o redirect OAuth e abre automaticamente o seletor ao retornar. Pastas aninhadas, múltiplas pastas por projeto, paginação e listagem de arquivos por diretório usam o Worker com refresh token criptografado. O vínculo `users/{uid}/driveFolders/{id}` guarda somente metadados mínimos, exige o projeto do próprio usuário pelas Firestore Security Rules e não duplica binários. A listagem de mídia inclui prévia `iframe` do Google Drive dependente de cookies/conta e fallback de abrir no Drive. Não há streaming próprio, upload, sincronização em background, comentários ou revisões concluídos nesta etapa.

## Cache de credenciais Drive e coordenação de refresh (17/10/2026)

**Decisão tomada:** reutilizar access tokens no D1 existente, cifrados com AES-GCM e AAD separado por finalidade, UID, conta Google, connectionId, revisão da credencial e versão aleatória do cache. Nenhum token em frontend, logs, Cache API pública, KV ou Firestore. Sem novos serviços/dependências. Evitar L1 em memória neste estágio: leituras D1 continuam verificando a conexão ativa, sem invalidadores distribuídos adicionais.

`0003_access_token_cache.sql` acrescenta ciphertext, expiração, versão de cache, lease e cooldown à própria conexão. A validade usa expires_in contado conservadoramente desde antes da chamada Google, com margem de 60 segundos. Cache válido exige conexão connected carregada do D1. A primeira utilização após migração gera o cache sem reconectar usuário; não se reutiliza retrospectivamente o access token do callback.

Um UPDATE condicional adquire lease de 20 segundos por UID/conexão/revisão, usando relógio SQL. Renovação tem timeout de 10 segundos; publicação exige lease ainda válido, mesmo proprietário e revisão/status inalterados. Rotação do refresh token e publicação do cache acontecem em um único UPDATE; respostas atrasadas não sobrescrevem consentimento novo, revogação ou outro lease. Contendores fazem polling limitado a oito segundos com backoff até um segundo; após esse limite retornam 503 categórico, sem derrubar a conexão. Não é promessa de exactly-once: crash, timeout e lease expirado podem causar chamadas Google extras, mas o fencing impede publicação antiga.

Consentimento novo, desconexão e invalid_grant invalidam cache/lease atomicamente com a mudança da conexão. invalid_grant exige também o lease vigente antes de invalidar: um erro atrasado não apaga uma conexão renovada. Falhas transitórias preservam refresh token e aplicam cooldown curto para impedir uma sequência de tentativas pelos contendores. Operações já em voo no Google podem terminar durante uma desconexão; nenhum cache consegue revogar retroativamente uma requisição já enviada.

`drive-client.ts` centraliza apenas GETs JSON no host/path fixos do Drive, sem redirects nem binários. Um 401 invalida somente a versão rejeitada, obtém credencial atual e repete a leitura no máximo uma vez. 403 por permissão, 403/429 por cota, 404 e 5xx são distintos; 403 não provoca refresh automático. Sem retries automáticos de escrita, cron ou sincronização em background. Listagem de pastas/conteúdo, metadados e about usam o mesmo cliente; revogação continua explícita.

Observabilidade: eventos drive_token_cache com outcome e duração, sem UID, e-mail, connectionId, URL, token ou corpo de erro Google. Logs amostrados não são contadores exatos de cobrança. Comparar refresh_started/refresh_succeeded, hit/hit_after_wait, wait_timeout/refresh_failed e duração antes/depois. D1 acrescenta leitura por PK para validação da credencial e escritas somente em renovação/invalidação/lease, em troca de eliminar a maioria das chamadas OAuth.


## Biblioteca 2.0 — composição da interface DEV (PR #29)

**Estado: implementado e validado no CI da PR #29 (TypeScript, builds e emuladores/browser); QA com Google Drive real e merge pendentes.** Os contratos do Worker `GET /integrations/drive/:connectionId/folders` e `.../folders/:folderId/items` e a coleção privada Firestore `users/{uid}/driveFolders` permanecem inalterados. O Drive é fonte dos arquivos; Firestore registra apenas os metadados mínimos do vínculo com o projeto. Desvincular remove apenas o documento de vínculo, sem apagar mídia nem modificar o Google Drive.

No frontend, `DriveConnectionPanel` orquestra estado de conta, permissões e vínculos. `DriveLibraryUI` fornece as vistas do explorador, seletor, prévia e confirmação de desvinculação, com estilos isolados em `drive-library.css`. O seletor permite seleção múltipla através de pastas/páginas, executando gravações individuais já autorizadas; uma falha parcial preserva os vínculos confirmados e mantém o seletor aberto. Ações no projeto não criam upload ou permissão Google adicionais.

A alternância de projeto é a fonte única do filtro de pastas. A Biblioteca recupera vínculos uma vez por identidade, com leitura independente do estado OAuth, evitando interpretar falha temporária de API como desconexão. Consultas de pastas e arquivos têm revisão lógica local (request ID) para descartar respostas atrasadas após mudança de navegação. Paginação é incremental; filtros de texto são **locais apenas sobre os itens já carregados**, nunca apresentados como busca total no Drive. A interface não guarda tokens nem arquivos privados em cache persistente; a leitura Google continua autorizada no Worker. A fonte do contador de pastas da navegação é a coleção de vínculos, e não `libraryAssets` da demo.

No desktop há navegação de pastas + arquivos em duas colunas; em telas pequenas, somente um nível de navegação é visível por vez. Overlays oferecem foco e Escape, bloqueio do scroll de fundo e controles nomeados, respeitando tema, navegação por teclado e `prefers-reduced-motion`. Não existe escopo ampliado, nova infraestrutura, upload, busca global indexada nem novos registros persistidos nesta PR.

QA obrigatório: contas Drive reais autorizadas, pastas vazias, subpastas, troca rápida, paginação, falha de rede e token, modal desktop/mobile, preview com fallback, isolamento A/B no Firebase e ausência de regressão da demo Pages. A execução mockada em Playwright não equivale a esse QA com Google real.

### Exclusão permanente de conta — implementação DEV (PR #30)

Decisão tomada na revisão de 18/10/2026: fence administrativa separada `accountDeletionFences/{uid}` bloqueia recriação por JWT residual após remoção do perfil. Retenção mínima de 24h em conjunto com D1; limpeza retomável. Migração `0006` mantém a etapa de falha para revisão e protege trocas OAuth em andamento com guard durável/credencial criptografada. Não é possível garantir atomicidade entre emissão Google e persistência D1; a janela ambígua exige revisão manual e nunca permite sucesso presumido. Passos limitam chamadas/tempo abaixo do lease. Monitor DEV por contagens D1 em Actions, sem dados privados. IAM, smoke administrativo real, CI e publicação DEV validados; migrações/Cron remoto conferidos e Drive real conectado na conta de teste. A exclusão real pela interface foi confirmada; por solicitação do proprietário, a ação de exclusão foi retirada do convite ao cadastro e permanece apenas em Configurações. Evidências em [ACCOUNT-DELETION.md](ACCOUNT-DELETION.md).

O frontend exige frase exata e confirmação explícita. O backend exige autenticação Google recente (até 300 segundos de `auth_time` assinado); login recente é reaproveitado sem popup. Após 401 `invalid_identity`, o próximo clique explícito confirma com Google, usando `login_hint` para a conta atual sem forçar o seletor. Escolher outra conta é rejeitado pelo SDK e pela conferência de UID antes de enviar nova solicitação. O e-mail da conta é exibido no modal. Renovar JWT não equivale a renovar autenticação. O Cloudflare Worker valida assinatura/autenticação recente, determina UID pelo token e coordena uma saga D1 com leases/cron, revogação Drive, exclusão recursiva Firestore e exclusão Firebase Auth por último. Firebase Rules bloqueiam escritas após `deletionState=deleting`; D1 triggers rejeitam novo consentimento OAuth. As APIs administrativas usam conta de serviço com segredo no Worker; **nunca** no frontend. Os caminhos do adaptador são derivados de `FIREBASE_PROJECT_ID` e validados contra `project_id` do segredo; o gateway de DEV permanece restrito ao projeto `roteiva-web-dev`. Nenhum arquivo original no Google Drive é excluído. Documentação e pré-requisitos: `docs/ACCOUNT-DELETION.md`.

Estado: PR #30 publicada no DEV, IAM validado e exclusão real confirmada em 18/10/2026: identidade e dados ausentes, outra conta intacta, concessão Drive revogada e arquivo original preservado. A tela antiga não consultava a conclusão. A correção subsequente na PR #31 adiciona polling autenticado a cada dez segundos e confirmação final somente após `completed`; indisponibilidade/revisão não anunciam sucesso. O perfil raiz é removido antes de Auth; a fence independente impede recriação e o primeiro acesso com perfil ausente consulta o job antes de exibir cadastro. Token GET não força renovação após remoção Auth; POST mantém renovação e reautenticação. Cron limita uma conta por invocação e Firestore a 30 chamadas, reservando margem no limite Free de 50 chamadas externas; fila roda por próxima tentativa/último progresso. Sucesso parcial limpa erros anteriores; ausência de progresso por orçamento gera erro operacional explícito. A tela de primeiro acesso oferece somente cadastro ou troca de conta, conforme solicitação do proprietário; o backend continua tolerando identidade sem perfil. A publicação da PR #31 segue o pipeline oficial da master após CI aprovado; sua evidência fica vinculada à PR. Confirmação de entrega dos alertas permanece pendente. Não houve segunda exclusão real após a mudança perfil/Auth; a ordem possui regressões automatizadas. `ACCOUNT_DELETION_ENABLED=true` no ambiente DEV aciona a disponibilidade somente se o segredo administrativo estiver configurado. As migrações D1 são aditivas. PROD futuro terá Worker/segredos/IAM próprios; não reutilizar credenciais DEV.

### Cache do Firebase Hosting e atualização de rotas SPA (18/10/2026)

**Decisão tomada:** Firebase Hosting aplica regras de headers ao **caminho original da requisição**, antes do rewrite SPA. Definir cache somente em `/index.html` deixa rotas diretas como `/configuracoes` com cache padrão de uma hora e pode servir HTML de uma versão antiga, incluindo a experiência anterior da exclusão de conta. A configuração passa a definir `Cache-Control: no-cache, no-store, must-revalidate` por padrão (`source: "**"`) e uma substituição posterior em `/assets/**` com `public, max-age=31536000, immutable` para artefatos hashed Vite. A ordem é intencional, para preservar cache longo somente em URLs versionadas. Teste estrutural no CI mais verificação de headers HTTP reais após deploy da master. Isso atualiza o shell HTML no próximo acesso, mas não força recarga de uma aba já aberta nem altera o cache privado Firestore IndexedDB.

### Zona de perigo e cache privado automático (18/10/2026)

**Decisão tomada:** o cache Firestore persistente é uma otimização interna habilitada automaticamente no cliente Firebase, sem alternância em Configurações. A biblioteca Firebase armazena por projeto e o manifesto Roteiva `roteiva-cache-v2:{uid}` é separado por UID. Antes de usar documentos locais, o código lê `users/{uid}/sync/state` diretamente do servidor e compara a revisão por domínio e a contagem de documentos com o manifesto; alterações remotas forçam atualização, inconsistências exigem leitura segura do servidor e falhas de armazenamento resultam em cache volátil ou nova consulta. Na saída, o app invalida manifestos ANTES da tentativa de limpeza IndexedDB; se outra aba impedir a limpeza, dados locais ainda podem existir e o erro é informado. Persistência automática melhora tempo e franquia Firestore, mas exige cautela em dispositivos compartilhados; não substitui a validação de permissão, versão e UID. A interface remove exportação parcial e controles técnicos de cache de Configurações (rotinas internas de exportação não são apagadas) e cria uma seção independente `Zona de perigo` com botão destrutivo em vermelho e confirmação/reautenticação já existentes. Sem alterações no Worker/Drive ou nas regras Firestore.

## Decisão de CI/CD (2026-10-18): pipelines independentes e operações Firebase protegidas

**IMPLEMENTADO no código, aguardando validação Actions na PR:** frontend React/Vite publica apenas Hosting, API Cloudflare/D1 publica Worker/migrações em pipeline própria, e Firestore rules/indexes são isolados num workflow de segurança. Sem dependência de GitHub Pages. E2E completo noturno/manual; testes emulador A/B obrigatórios em mudanças de regras, auth e persistência. Previews de PR internos têm build sem credenciais e publicação temporária no DEV mediante dispatch na master.

**PARCIAL/BLOQUEADO:** operações administrativas Firebase exigem repositório privado, credencial IAM exclusiva e habilitação `FIREBASE_DATA_OPS_ENABLED`; apenas leituras de contas e fixtures não comerciais foram implementadas. Não permitir patch administrativo arbitrário, pois o modelo de domínio usa revisão sequencial e `sync/state` transacional que a conta admin poderia contornar. PROD continua não provisionado (exemplos isolados, sem endpoints ou credenciais). Ver instruções em DEVELOPMENT.


## Decisão de segurança: prévias Google Drive (18/10/2026)

A Biblioteca usa Drive API somente para metadados e tokens OAuth restritos ao Worker. Miniaturas são imagens transitórias de até 1 MiB, requisitadas via endpoint autenticado, com verificação de UID e da conexão, sem aceitar URL arbitrária do navegador. O cliente só gera `blob:` URLs em memória, com carregamento sob demanda, sem salvar conteúdo de mídia em Firestore/D1 ou cache persistente. O backend não transfere vídeos originais; a prévia ampliada continua no visualizador do Google Drive, sujeita às permissões/cookies do navegador. Contrato de fallback: ausência de miniatura mantém ícone correto por MIME; expiração da URL provoca nova leitura dos metadados ao tentar carregar novamente. Esse recurso está no DEV, não cria dependência de Storage ou transcodificação.


### Otimização Drive — arquitetura de cache segura

O cliente mantém um LRU em memória para listas (24 entradas) por UID/conexão/pasta/busca, e cache de miniaturas com URL Blob temporária. Não há armazenamento persistente de mídias nem respostas sensíveis. O Worker emite tickets cifrados (AES-GCM com contexto de uso distinto dos tokens OAuth) para reutilizar o `thumbnailLink` obtido na listagem. Validar sempre JWT Firebase, dono da conexão, revisão e escopo; tickets expiram em 90 segundos. Nunca reutilizar entre usuários nem permitir URL de destino arbitrária. A rota legada faz consulta de metadados para compatibilidade.

Limites separados para preflight, listagens e thumbs evitam que 27 miniaturas impeçam a navegação. Google Drive continua sendo fonte de verdade; o cache reduz latência percebida e revalida dados envelhecidos. Não há sincronização incremental, tabelas D1 adicionais nem uso de Firebase Storage.

## Controle de acesso SaaS — infraestrutura DEV (19/10/2026)

Decisão tomada: rollout em entregas compatíveis; a primeira publica somente a migração aditiva D1, sem alterar autorização ou regras. Trial imutável de sete dias; cortesia de beta de 30 dias em ledger separado para contas existentes, conforme decisão do proprietário. Credencial administrativa existente tem IAM suficiente; nenhuma ampliação autorizada ou necessária. Ver [controle de acesso](ACCESS-CONTROL.md) para sequência, risco de projeção distribuída e reversão. ADM será outra aplicação. Estado: **DEV implantado** (migrations 0007/0008/0009, Worker, frontend e regras de enforcement pela PR #48); **homologação remota parcial**. Três contas existentes cobertas e Drive real confirmado; cadastro/login/suspensão/cortesia de fixture comprovados, mas término da exclusão, expiração e isolamento A/B remoto ainda pendentes.

Decisão tomada — provisionamento compatível: marco/coorte imutáveis em D1, cortesia 30 dias baseada no createTime Firestore, backfill pelo Cron e provisionamento sob demanda no Drive por flag server-side. Ambos usam verificação de perfil e bloqueio de exclusão; não existe bypass comercial. Na etapa transitória, as regras somente adicionavam leitura privada da projeção; **as regras finais restritivas já estão publicadas**. Projeção usa precondição Firestore e estado D1 lido após sua versão; operação ADM futura deve seguir a fence e reconciliação descritas abaixo antes de revogar em D1. Falha distribuída não equivale a revogação concluída. Detalhes em ACCESS-CONTROL.md.

Frontend comercial: RegistrationGate → AccessGate → FirebaseWorkspace. AccessGate chama provisionamento autenticado e aguarda snapshot do servidor; cache persistido não concede entrada. Expiração/suspensão apresentam gestão mínima da conta (reverificar, sair, exclusão). Relógio cliente não autoriza APIs. Deploy Hosting verifica versão Worker antes de publicar UI; regras restritivas foram publicadas na fase separada da PR #48. Sem mudanças visuais fora desse fluxo e status em Configurações.
Correção de runtime: todos os fetches de acesso/backfill usam redirect manual, único modo suportado pelo Worker que impede encaminhamento automático de bearer. redirect error foi reproduzido como TypeError no workerd local e removido. Não altera IAM nem autorização; status 3xx continua negado.
Observabilidade comercial: logs sanitizados por estágio e HTTP status distinguem leitura de perfil, leitura/escrita de projeção e enumeração de backfill. Nenhum dado pessoal/credencial é registrado. Homologação remota da fase 2 encontrou a falha de redirect antes do provisionamento; após correção, backfill e Drive foram confirmados e a UI publicada. Após smoke de cadastro/login, regras finais publicadas pelo run 39358435474; cenários restantes registrados em ACCESS-CONTROL.md.

Enforcement final publicado (PR #48): Firestore valida UID/schema da projeção, suspensão e request.time; Worker deixa de provisionar implicitamente no Drive quando ACCESS_PROVISION_ON_DRIVE=false. A ativação depende de backfill completo, cobertura das projeções, UI publicada e validação real. Status e perfil próprios permanecem legíveis sem acesso comercial. Novos pedidos de exclusão exigem acesso ativo no backend; operações já aceitas continuam retomáveis. D1/Firestore continuam sem transação conjunta; mutações privilegiadas futuras exigem protocolo com fence e reconciliação descrito no runbook.

Decisão tomada — fence distribuída: access_accounts.sync_pending, adicionada por 0009, bloqueia ensure/Drive enquanto o futuro serviço privilegiado coordena negação/projeção e ledger. Protocolo obrigatório: fence D1 → negação Firestore com CAS → mutação D1 → projeção nova verificada → liberação da fence. Nenhum endpoint ADM foi criado. Isto substitui a descrição resumida de deny-first sem fence, insuficiente contra ensure concorrente. Falhas mantêm negação e pendência.


## Trial único por identidade — PR #51, revisão de 20/10/2026

**PUBLICADO no DEV pela PR #51; homologação Google rastreada no runbook.** Decisão: D1 batch atômico para HMACs de Google/e-mail/UID, titular imutável e propagação de conflitos; migration aditiva 0011 fixa verificador de chave; preserva a fence de inserção comercial existente desde 0008. Publicação Firestore em commit atômico com precondição do perfil e da projeção impede órfãos durante exclusão. Saga exige marcador antes de cada fase; jobs anteriores sem marcador precisam de nova solicitação autenticada. Sete dias e marco beta de 30 dias permanecem imutáveis. Retenção técnica dos marcadores enquanto existir a oferta, com revisão anual; base legal e direitos precisam de avaliação do controlador. Procedimentos, fontes e limites em [TRIAL-REUSE-PREVENTION.md](TRIAL-REUSE-PREVENTION.md).


## Exclusão somente em Configurações com acesso ativo — decisão de 20/10/2026

Por solicitação do proprietário, remover a ação de todos os estados fora do workspace (expirado, suspenso, sem cadastro ou erro de validação). O único ponto de entrada da UI é a Zona de perigo de Configurações, sob AccessGate ativo. POST /account/deletion consulta os direitos reais no D1 antes de aceitar um novo job; ausência, expiração, suspensão ou sync_pending impedem a solicitação, sem executar mutações remotas. Status autenticado, cron e retries de jobs anteriormente aceitos continuam disponíveis para não interromper uma exclusão em andamento. Não altera marcadores antifraude, prazos ou concessões.

## Upload e Google Picker — PR #52 (20/10/2026)

**Decisão tomada, homologação real pendente:** manter OAuth confidencial amplo
somente no Worker e usar novo GIS TokenClient no browser quando uma pasta existente
precisar de autorização. `include_granted_scopes:false` solicita apenas drive.file
mais openid para comprovar subject; não reduz token existente. Tokeninfo/OIDC
comprovam cliente e conta da conexão antes de abrir Picker; ID escolhido é
conferido e a permissão real é revalidada no backend. Sem escrita Drive irrestrita.

**Decisão tomada:** attempts D1 mínimos com file ID pré-gerado pelo Google; a
confirmação fica vinculada a UID/conexão/revisão/projeto/destino/metadados. Capability
cifrada para recuperar resposta de início, TTL 24h e limpeza limitada no cron
existente. Arquivos continuam exclusivamente navegador→Drive; nenhum byte em D1
ou Firestore. A leitura REST do projeto impede usar link órfão; ascendência e
canAddChildren são verificados na pasta de destino, não no breadcrumb.

**Decisão tomada:** DriveTransfersProvider vive no workspace autorizado, preserva
fila ao trocar telas e é desmontado no logout/bloqueio. Progresso por bytes
confirmados, probes após incerteza e retry separado de confirmação. Só cache da
pasta alvo é invalidado; o resultado pode incluir thumbnailTicket privado.
Sem retomada após F5, polling de mídia ou reload global. Capability Google emitida
não tem revogação instantânea garantida; cancelamento bloqueia próximas operações
do cliente e desconexão bloqueia novas operações Worker.

**Homologação real parcial:** chave Picker restrita criada e configurada como
Worker Secret; origem JavaScript DEV existente conferida. Proprietário autorizou
publicação temporária da branch no DEV sem merge, com migration aditiva0012 e
reversão em caso de falha; nenhuma mudança nos gates permanentes de CI/CD.
Depois da prova Chrome, o proprietário autorizou o merge: PR #52 integrada em
`9652d98` e publicada no DEV pelos workflows oficiais de API e Hosting.
Uma conexão com acesso ativo foi identificada sem alterar entitlement. Picker
real autorizou a pasta exata; UI Chrome concluiu upload direto de 276.509.032 bytes,
com parent/tamanho Google e tentativa completed/capability apagada no D1 conferidos.
Chave mantém somente Picker API e referrers DEV + docs.google.com (iframe oficial),
inclusão expressamente autorizada. Recuperação com rede real ficou manual/pendente
por preferência do proprietário; A/B remoto, revogação, Safari e dispositivo físico
também pendentes. Não extrapolar o sucesso Chrome para esses aceites.
Configuração e matriz: [DRIVE-UPLOAD.md](DRIVE-UPLOAD.md).

**Decisão operacional do proprietário — 20/10/2026:** homologar a PR #55 diretamente no DEV existente e em suas contas/dados descartáveis. Worker, D1 e Hosting receberam o código validado antes do merge, com os segredos OAuth existentes. Não criar ambiente ou credenciais de QA adicionais para esse aceite. Pipeline automático permanece limitado à master; detalhes verificáveis em [REVIEWS-MVP.md](REVIEWS-MVP.md).


### Decisão — performance e quotas Cloudflare Free (21/10/2026)

Separação de manutenção por criticidade: exclusões e revogações de Drive/ACLs usam polling D1 de 1 minuto; retenção e backfill usam 15 minutos. Nenhum cache em memória de Worker é autoridade para status de revogação. Busca de aprovações possui debounce na interface, mantendo autorização real no backend. Miniaturas passam diretamente ao cliente via streaming apenas se a resposta do Google declarar comprimento válido (até 1 MiB) e não comprimido; tamanho divergente aborta a transmissão. Fallback existente continua para comprimento incerto. Nunca armazenar imagens privadas em cache público.

## Decisão de navegação — 21/10/2026

**Decisão tomada:** retirar a barra superior global e o banner redundante de nuvem do shell compartilhado. A busca de Projetos/Clientes passa para o conteúdo, mantendo o carregamento completo sob demanda. O menu móvel usa um controle independente no conteúdo. Alertas reais de falha/sincronização e o modo demo são preservados; contratos de dados e persistência não mudam.

## Decisão — capas privadas de projetos (21/10/2026)

**Decisão tomada:** capa é uma referência opcional no documento de projeto: `coverConnectionId`, `coverFileId`, `coverName`, `coverX`, `coverY`, `coverZoom`. O codec preserva projetos legados sem capa e omite todos os campos ao remover. As gravações continuam nas transações revisionadas existentes; regras exigem o conjunto completo, tipos, limites e proprietário. Referências de conexão não concedem acesso: a API verifica Firebase, acesso comercial e propriedade da conexão em cada leitura.

`GET /integrations/drive/:id/cover-images` busca imagens paginadas (40 por página), com escape de busca e miniaturas privadas existentes. `GET /integrations/drive/:id/files/:fileId/cover` valida tipo, tamanho (8 MiB), dimensão (40 milhões de pixels quando informada) e lixeira antes de ler a imagem original autenticada, sem seguir redirecionamentos. Valida o tamanho efetivo e reconfirma estado/revisão da conexão antes de liberar bytes. Não cria ACLs, URLs públicas, tokens de mídia duráveis ou cópia permanente. Usa apenas a permissão de leitura já concedida à Biblioteca; não amplia OAuth.

No navegador, capas só aparecem com conexão ativa, carregam ao se aproximarem da área visível e têm no máximo três downloads concorrentes. URLs de objeto são revogadas ao trocar imagem, projeto ou conta. O editor mantém rascunho local até Salvar; arraste, roda do mouse, pinça (Pointer Events) e gestos nativos do Safari compartilham a mesma geometria proporcional (formato 2,5:1). O zoom preserva a âncora sob o cursor/centro dos dedos; coordenadas e zoom continuam com os mesmos limites persistidos. Sliders foram removidos; botões compactos e teclado oferecem alternativas acessíveis. Diálogo nativo garante foco modal e Escape. Falhas não são substituídas por fotos fictícias.

**Decisão de cursor:** diálogos nativos usam o cursor do sistema. O efeito decorativo permanece na camada da página e não deve ocultar o cursor sobre `dialog:modal`, inclusive quando um modal abre com o ponteiro parado. CSS e detecção do alvo cobrem abertura e movimentação, sem tentar ultrapassar a top layer com z-index.

**Estados de carregamento do editor:** o shell tem dimensões independentes da quantidade de imagens e do estado da rede. A lista rola em um contêiner próprio; a prévia conserva a proporção da capa. O mesmo indicador acessível (`role=status`) representa download inicial e busca da lista, sem modificar contratos de API ou persistência. O debounce de busca não limpa resultados quando o termo não mudou.

**Navegação e ações de conta:** barra lateral contém apenas rotas, numa lista única. Histórico de atividades pertence ao dashboard e fecha ao trocar de rota. Tema e logout usam um disclosure de perfil com fechamento por Escape, saída de foco e clique externo; reutilizam as mesmas funções de persistência de tema e logout/limpeza de cache, sem mudança de contratos ou permissões.

**Decisão — movimento do menu de conta:** fases fechado/aberto/fechando permitem animar a saída antes de desmontar. O término da animação do próprio painel encerra a fase; reabertura interrompe a saída sem temporizadores. Durante a saída, o conteúdo fica inert e fora da árvore acessível. Tema preserva o painel/foco; logout fecha e executa o fluxo existente imediatamente. Sem alterações em Auth, cache ou contratos.
