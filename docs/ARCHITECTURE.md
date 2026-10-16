# Arquitetura do Roteiva — MVP SaaS

**Estado: projeto arquitetural aprovado como direção técnica, NÃO implementado. Atualizado em 16/10/2026.**

Esta é a fonte de verdade sobre **como o sistema deverá funcionar**. O acompanhamento do que já foi entregue fica no [roadmap](MVP-ROADMAP.md); instruções operacionais em [desenvolvimento](DEVELOPMENT.md). Mudanças de arquitetura e decisões novas devem atualizar este arquivo **no mesmo PR**, conforme [AGENTS.md](../AGENTS.md).

## 1. Objetivo e princípios

O Roteiva é um SaaS para profissionais audiovisuais que precisam gerir clientes, produções, prazos, receitas/despesas, arquivos, versões e revisões.

**Princípios:** custo mínimo para os primeiros 2–10 usuários; serviços remotos com franquias gratuitas; segurança e isolamento entre contas por padrão; arquivos grandes no Drive do proprietário; operações privilegiadas no backend; frontend responsivo e acessível; simplicidade antes de funcionalidades avançadas; crescimento sem reescrita desnecessária.

Não confundir **R$ 0 enquanto dentro da franquia** com infraestrutura ilimitada e gratuita. Monitorar cotas e impor limites de uso antes de expandir. Nenhum computador pessoal, túnel ou servidor caseiro é parte da arquitetura.

## 2. Estado atual versus destino

| Área | Código atual (out/2026) | MVP-alvo (a implementar) |
|---|---|---|
| UI | React 19 + Vite 8 + TypeScript, `index.html` + `src/`, frontend único | **Migrado** e preparado para Firebase Hosting; reutilizar UI existente ao adicionar Auth/Firestore |
| Hospedagem | GitHub Pages publicado; **Firebase Hosting configurado, mas não provisionado/deployado** | Vincular projeto Firebase e publicar mesmo build estático na raiz; Pages continua como demo |
| Login | Demo anônima React/Vite, sem login real | Firebase Authentication com provedor Google |
| Dados | Apenas estado React + `localStorage`; D1/Drizzle removidos do código ativo | Cloud Firestore com entidades independentes e Security Rules |
| API | Nenhum servidor/Worker/API de negócio no código | Cloudflare Worker TypeScript, API explícita com autenticação Firebase verificada |
| Conexão Drive | Ausente no repo atual; referência em código BRBET histórico externo | OAuth 2.0 próprio, consentimento mínimo e refresh tokens cifrados no D1 |
| Mídias | Upload desativado; binding R2 removido | Drive da conta do profissional, sem armazenar arquivos binários no Firestore/D1/Worker |
| Aprovação | `/review` exibe aviso estático na SPA | Convites privados, feedback estruturado e acesso ao vídeo de acordo com a ACL do Drive |
| Cobrança | Não implementada | Plano inicial controlado pelo servidor; cobrança automatizada só depois |

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

- **Atual:** React 19 + Vite 8 + TypeScript, UI e estilos em `src/`, `index.html` na raiz. `pnpm build` gera `dist/` com base `/` para Firebase Hosting; `pnpm build:pages` gera `dist-pages/` com base `/roteiva-web/`. Firebase Hosting está **configurado**, mas sem projeto/credenciais para deploy. Auth/Firestore e Worker/Drive continuam futuros.
- Separar UI, lógica de domínio e integrações em módulos: `features/*`, `services/firebase`, `services/drive`, `services/api`, `domain/*` (estrutura ilustrativa, não criada ainda).
- Componentes consomem contratos tipados de repositórios/serviços, não chamam Firebase ou Drive diretamente em todos os pontos da UI.
- Estados explícitos: loading, vazio, erro, sem permissão, offline e conflito; evitar alteração otimista sem rollback.
- Respeitar tema claro/escuro, movimento reduzido, navegação por teclado e formulários acessíveis.
- Preservar componentes e a demo Pages com uma **única entrada React** e configuração Vite; não duplicar regras de negócio. Qualquer mudança futura no frontend deve respeitar a UI existente e ser documentada.
- Minimizar leituras Firestore: consultas paginadas/filtradas por workspace, listeners apenas onde úteis, evitar recarregar coleções completas a cada interação; gravar somente entidades alteradas.
- Projetos podem guardar thumbnails/metadados leves; **não** criar base64 gigantes, mídia nem segredos no Firestore ou `localStorage`.

## 5. Identidade, espaços de trabalho e autorização

**Firebase Authentication** autentica a sessão web com Google. A escolha da conta usada para **login no Roteiva** pode ser diferente da conta Google autorizada para armazenar arquivos; não confundir tokens de login Firebase com tokens da Drive API.

O backend deve validar **assinatura, emissor, audiência, expiração e UID** dos Firebase ID Tokens via mecanismo compatível com Cloudflare Workers (ex.: WebCrypto/JWKS com cache seguro). Nunca confiar em UID/email fornecidos livremente no body/header. Verificar sessão revogada ou política adicional onde exigido, e assumir que o ID token tem vida limitada. Avaliar limites de CPU do Workers Free.

**Modelo inicial:** um workspace por profissional, com `ownerUid` imutável para usuários comuns. Coleções e consultas sempre escopadas ao `workspaceId`. Cada acesso consulta membro/permissões em lugar confiável; IDs de documento não substituem autorização. Não usar email como identificador principal.

**Colaboração no MVP:** acesso dos clientes a revisões específicas mediante convite e login Google (proposta inicial, pendente de validação de produto); não liberar todo o workspace. Equipes com papéis avançados são pós-MVP. Nunca expor financeiro, contatos ou outros projetos ao cliente revisor.

**Segurança Firestore:** regras deny-by-default para cada coleção/subcoleção, `request.auth.uid`, vínculo explícito ao workspace, validação de campos/sizes/status, limites de escrita, impossibilidade de autoatribuir plano/papel, impedir escalonamento via referências cruzadas, testes de acesso cruzado (usuário A lendo/escrevendo dados de B), testes de convites e recursos revogados. Segurança não depende apenas dos filtros do frontend. Considerar App Check como barreira complementar, não autenticação.

## 6. Banco de negócio — Cloud Firestore

Modelo **proposto** (ajustar contratos e regras antes de implementar):

```text
users/{uid}                         perfil e preferências não sensíveis
workspaces/{workspaceId}            ownerUid, nome, createdAt, versão
  members/{uid}                     role (owner; reviewer limitado conforme fluxo)
  clients/{clientId}                contato e relacionamento
  projects/{projectId}              cliente, briefing, status, prazo
    tasks/{taskId}                  checklist e atribuição
    deliverables/{deliverableId}    entrega e tipo
      versions/{versionId}          metadados de cada corte/arquivo
  events/{eventId}                  agenda e vínculo com projeto
  financeEntries/{entryId}          receita/despesa, amountCents, competência, situação
  assets/{assetId}                  referência Drive, nome, mime, tamanho, versão
  reviewInvites/{inviteId}          cliente autorizado, versão, estado, expiração
  reviews/{reviewId}                comentários, timestampMs, autor, decisão
```

Esquema ilustrativo; avaliar se subcoleções complexas atrapalham regras/queries e estabelecer índices necessários. Toda referência cruzada deve ser validada, inclusive `projectId`, `clientId`, `assetId` e `versionId`. Documentos precisam de `createdAt`, `updatedAt`, responsável e versão de esquema quando cabível.

**Dinheiro:** usar centavos inteiros, não ponto flutuante para valores persistidos. **Datas:** ISO, timezone explícito (agenda no fuso do usuário e timestamps UTC); evitar datas formatadas `DD/MM/YYYY` como contrato persistido. **Exclusão:** definir semântica (cascade/soft delete), revogação de convites e referências órfãs. **Paginação:** índices planejados e limites por consulta.

**Nunca** copiar o JSON completo de `studio_workspaces` para um único documento Firestore: há limites de documento, custos de regravação e conflitos. Migrar entidade por entidade com camada de adaptação/versão. Exportação JSON deve cobrir registros de negócio; não confundir exportar metadados com copiar os arquivos Drive.

## 7. Backend — Cloudflare Workers

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

## 8. D1 e proteção de tokens

D1 é o banco SQL serverless vinculado ao Worker e serve **somente à infraestrutura privada**, principalmente OAuth; não é armazenamento de mídia.

Modelo indicativo: `drive_connections(workspace_id, owner_uid, google_account_id, google_email, encrypted_refresh_token, iv, key_version, scopes, folder_id, status, created_at, updated_at)`. Índice/constraint para impedir conexão cruzada; permitir reconectar e substituir token de forma segura. **Jamais registrar um token legível** no D1, logs, Firestore, URLs ou no frontend.

- Cifrar refresh token com criptografia autenticada (AES-GCM) usando chave em Worker Secrets; nonce aleatório único, versão de chave e AAD que vincule conta/workspace.
- Renovar access tokens no Worker quando necessário, lidar com rotação e `invalid_grant` (reconexão). Access tokens de curta duração podem existir temporariamente em memória do Worker.
- Provar isolamento em testes com dois usuários e duas contas Drive.
- Definir política de retenção, revogação, exclusão de conta, rotação de chaves e recuperação operacional antes do piloto externo.
- Não criar caminho público que devolva refresh tokens. Se for inevitável delegar um **access token temporário** para o navegador fazer upload, restringir escopo/uso, manter só em memória e explicitar o risco; preferir sessão resumable limitada se validada.

## 9. Google Drive — arquivos do próprio usuário

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

Franquias de referência (sujeitas a atualização): Workers Free **100.000 requests/dia, 10 ms CPU/request**; Firestore Standard grátis **50.000 reads e 20.000 writes/dia, 1 GiB**; D1 Free possui limites próprios de queries/armazenamento. A franquia do Hosting e as cotas do Google Drive também precisam ser monitoradas por projeto e usuário. **2–10 usuários é cenário estimado, não garantia de custo fixo.**

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
| Frontend React/Vite, Firebase Hosting/Auth/Firestore | **Direção definida, pendente de implementação** | Migrar incrementalmente |
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

## 15. Estado após migração para Vite / Firebase Hosting

A [PR #4](https://github.com/EwertonMendes/roteiva-web/pull/4) removeu o backend antigo. A [PR #5](https://github.com/EwertonMendes/roteiva-web/pull/5) remove também Next.js/Vinext e a infraestrutura de renderização do template, **por solicitação explícita**, migrando para uma SPA React/Vite/TypeScript sem reescrever o visual.

**Aplicação ativa:** `index.html`, `src/main.tsx`, `src/dashboard-client.tsx`, `src/studio-features.tsx`, componentes de domínio e estilos em `src/`, `public/` e `vite.config.ts`. `/review` é um placeholder frontend até a revisão real existir.

**Deploy Firebase preparado:** `firebase.json` publica `dist/`, com fallback de rotas para `/index.html` e cache agressivo **apenas** para assets versionados em `/assets/`. `pnpm build` usa base `/`; GitHub Pages usa o mesmo frontend com base `/roteiva-web/`, isolado por outro build. O workflow Firebase é **manual**, exigindo configuração de projeto e credenciais próprias; nenhuma conta ou deploy foi criado automaticamente.

**Persistência:** `localStorage` com chave `roteiva-pages-demo-workspace-v1`, preservada. A API de armazenamento é isolada por origem; dados existentes no Pages não aparecem automaticamente no domínio Firebase. Não há autenticação, servidor, Firestore, OAuth, Drive, nem Cloudflare Worker/D1 ativos.

A futura implementação de Firebase Auth/Firestore deve substituir o armazenamento local por entidades seguras e respeitar as fases e critérios do [roadmap](MVP-ROADMAP.md), sem inventar integrações já disponíveis.
