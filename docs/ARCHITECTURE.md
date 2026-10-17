# Arquitetura do Roteiva — MVP SaaS

**Atualizado em 16/10/2026. Fundação Firebase DEV IMPLEMENTADA na PR #6; publicação DEV e testes automatizados validados; Google real e persistência conferidos em uma conta; segunda conta e dispositivos ainda em andamento. Worker/Drive e demais fases continuam PLANEJADOS.**

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
| API/Drive | Nenhum Worker, D1, OAuth Drive ou upload implementado | PoC nas fases futuras |
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

Carregamento por rota: `workspace-scopes.ts` define domínios completos necessários. A Visão Geral consulta agenda/atividades e um pequeno lote dos projetos recentes (até quatro) com as tarefas correspondentes; contagem por etapa, clientes e valores a receber usam agregações, exceto projetos cujo primeiro lote cobre o total, que reutilizam o resultado sem quatro consultas adicionais. A listagem de Projetos usa **cursor no Firestore** com páginas de até 24, filtro de status no servidor e consulta de tarefas por IDs da página. A lista de Clientes também usa cursor de 24, com total e contagem de recorrentes no servidor; carrega projetos completos separadamente para os contadores por cliente e só carrega entregas no detalhe. Buscas textuais em Projetos/Clientes solicitam o conjunto completo para não mostrar resultados incompletos. A abertura de detalhes busca os domínios integrais necessários, sempre após a confirmação de mutações pendentes. Financeiro e Agenda ainda precisam de domínios completos em suas telas próprias, portanto sua paginação visível permanece planejada. Configurações não baixa coleções de negócio em link direto; Biblioteca carrega apenas projetos para o seletor; exportação busca todos os domínios. Páginas parciais jamais são marcadas como domínio completo, nem podem causar exclusões implícitas. Com consentimento, cache de documentos pode ser reutilizado após verificar `users/{uid}/sync/state`: revisões independentes e contagens das sete coleções. O cache só é aceito se a versão armazenada corresponder à versão remota e se a contagem de documentos disponíveis for completa; caso contrário consulta o servidor. O stamp é criado após o registro inicial com contagens zeradas. Para contas legadas sem stamp, contagens são obtidas por agregações antes da inicialização transacional, sem download completo do histórico. Mutações atualizam os contadores e revisões na mesma transação. Sem listeners globais: no retorno à aba, depois de um intervalo mínimo, a aplicação verifica o estado e pede recarga explícita se houve alteração remota. Firebase usa comandos tipados (`src/data/firestore-commands.ts`) emitidos diretamente pelas ações (cliente, projeto, tarefa, entrega, financeiro, agenda, atividade), sem salvar snapshots a partir de efeitos de renderização; apenas a demonstração usa o snapshot localStorage. Os comandos consultam revisões, gravam documentos alterados e atualizam `sync/state` na **mesma transação**, rejeitando conflito. O método antigo `save(workspace)` permanece apenas para compatibilidade e testes, sem uso na UI Firebase. Nomes denormalizados de vínculos são atualizados junto da edição do cliente. Falhas de rede/permissão bloqueiam novas edições e permitem recarregar a nuvem. Sem fila offline ou migração automática.

Sem índices compostos exigidos na fase atual: consultas ordenam por documentId. Índices por filtros e agregações dependem da migração futura para consultas por tela. Tarefas e entregas são documentos independentes. Exportação JSON/CSV preservada, sem mídia. Exclusões de lançamento/agenda são pontuais; exclusão de conta e limpeza completa continuam planejadas.

## 7. Backend — Cloudflare Workers (PLANEJADO)

Worker TypeScript com rotas mínimas de **operação privilegiada**, não CRUD indiscriminado do que as Firestore Rules podem proteger:

| Contrato lógico (nomes provisórios) | Objetivo |
|---|---|
| `GET /health` | Saúde sem dados privados |
| `POST /oauth/drive/start` | Validar usuário e iniciar OAuth com state/PKCE quando aplicável |
| `GET /oauth/drive/callback` | Conferir state, trocar code, identificar Google account, cifrar refresh token |
| `GET /integrations/drive` | Estado da conexão do workspace autenticado |
| `POST /integrations/drive/disconnect` | Revogar autorização, remover token e atualizar estado |
| `POST /drive/uploads/init` | Autorizar owner/projeto e iniciar sessão de upload resumable (PoC obrigatório) |
| `POST /drive/share` | Conceder/revogar permissão no Drive sob ACL explícita |
| `POST /entitlements/*` | Alterações de plano apenas por processo administrativo seguro (futuro) |

As rotas são **contratos planejados** e ainda não existem. Incluir verificação de propriedade dos arquivos antes de compartilhar, rate limit, validação de entrada, CORS por allowlist DEV/PROD, logs estruturados sem segredos, tratamento de retries e idempotência. OAuth callback precisa de proteção contra CSRF, replay e vinculação ao usuário que iniciou o fluxo. A depender do fluxo, usar cookie seguro HttpOnly/SameSite e armazenamento temporário de state com expiração; **nunca confiar no UID vindo do retorno OAuth sem verificar o state**.

**Secrets do Worker:** OAuth client secret, chaves AES-GCM com versionamento, demais credenciais. Config pública do Firebase não é segredo, mas regras continuam obrigatórias. Sem service account JSON em código ou repo. CI/CD: segredo por ambiente, deploy DEV separado de PROD.

## 8. D1 e proteção de tokens (PLANEJADO)

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

## 10. Revisão e compartilhamento de mídia

**Recomendação para MVP, ainda não ratificada:** cliente autenticado com Google, convidado explicitamente para **uma entrega/versão**; acesso no Firestore + permissão real no Drive de acordo com a conta convidada. O cliente não ganha acesso a clientes, financeiro, projetos estranhos ou pasta raiz. Revogar convite **e** Drive ACL na mesma operação coordenada; tratar erros parciais e mostrar estado de revogação pendente quando necessário.

Fluxo: owner envia corte → vincula versão → convida revisor → revisor abre player/visualizador permitido pelo Google → comenta um timestamp **manual** → aprova ou solicita alterações → proprietário vê histórico e publica nova versão.

**Não prometemos ainda** player próprio com seek, timecode automático sincronizado, iframe com controle total, streaming privado a partir do Drive ou links sem login. Testar capacidade de preview, formato, DRM/cookies/navegadores e políticas do Workspace. Comentários e decisões ficam no Firestore; vídeos no Drive. Links por token anônimos são **etapa futura** e exigem modelo específico de segurança/revogação.

## 11. Assinaturas e autorização de planos

No piloto: plano ativado **administrativamente**, sem cobrança automática. Limites por plano devem ser verificados por autoridade confiável (Worker/claims controladas), **nunca** editáveis pelo próprio usuário. Firestore Rules precisam impedir adulteração de plano/papel. Não implementar checkout, webhooks ou colaboração avançada antes de validar fluxo básico e demanda.

Proposta comercial ainda exploratória: gratuito limitado, Solo e Studio. Não documentar preços como contrato comercial. Sem cota de armazenamento vendida pelo Roteiva, pois pertence ao Google Drive do assinante.

## 12. Cotas, observabilidade e plano gratuito

O DEV mantém Spark. Firestore Standard tem franquias de 50.000 leituras, 20.000 escritas e 20.000 exclusões por dia, 1 GiB armazenado e 10 GiB de saída/mês. Hosting estático oferece 10 GB de conteúdo e 10 GB de transferência/mês. Limites e comportamento no teto estão em [DEVELOPMENT.md](DEVELOPMENT.md). Worker, D1 e Drive não foram provisionados; suas cotas deverão ser avaliadas na PoC futura. **2–10 usuários é cenário estimado, não garantia de custo fixo.**

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

Limitações: sem atualização em tempo real entre abas; conflitos por documento e reload explícito; sem fila offline privada. OAuth Google real, segunda conta e Safari/iOS dependem evidência registrada no roadmap. Os componentes Worker/Drive acima continuam PLANEJADOS.


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
