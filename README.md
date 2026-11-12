# Roteiva

Prévia autenticada e seleção múltipla Dropbox foram acrescentadas na branch, ainda desativada nos ambientes publicados. A homologação de provedor e a integração final de uploads/aprovações continuam pendentes.

## Biblioteca virtual — implementação em andamento

A branch agora inclui API de comandos autenticados, registry de referências e interface virtual com seleção múltipla Drive. O desenvolvimento fica atrás de flags desativadas (`VIRTUAL_LIBRARY_ENABLED`/`VITE_VIRTUAL_LIBRARY`); não habilitar em PROD antes de completar aprovações, mídia e homologação.

Branch `codex/virtual-library`: fundação local aditiva de árvore virtual e contratos de revisão de conteúdo. Ainda não integrada à interface nem habilitada em DEV/PROD. O produto publicado mantém seu comportamento atual.

**Domínio próprio publicado:** [roteiva.com](https://roteiva.com), login no mesmo domínio e API [api.roteiva.com](https://api.roteiva.com), usando os recursos PROD existentes. HTTPS, www, login real, recarga, links antigos e conexões preservadas conferidos; marcas Google verificadas/publicadas. Aprovação dos escopos Drive e produção Dropbox continuam separadas no [roadmap](docs/MVP-ROADMAP.md#domínio-roteivacom--11112026).

**Preparação sem domínio final:** preflight público DEV/PROD aprovado e recuperação de uma cópia cifrada Auth/Firestore PROD validada em emulador. Pedidos dos provedores, ciclo completo com usuários externos, operação contínua e aparelhos físicos continuam com aceites separados. Roteiro e evidências no [roadmap](docs/MVP-ROADMAP.md#preparação-sem-domínio-final--11112026).

**Recuperação de sessão e acesso:** leituras iniciais ausentes ou recusadas pelo SDK são conferidas no servidor com a identidade do próprio usuário. A recuperação renova a sessão e restabelece o acompanhamento de acesso sem recriar cadastro ou concessões. O alerta mantém 20 px antes dos botões; publicado e homologado em DEV/PROD; evidências no [roadmap](docs/MVP-ROADMAP.md).

## Ambientes DEV e PROD — publicado em 11/11/2026

**IMPLEMENTADO E PUBLICADO:** um repositório e uma base de código, com Cloudflare em contas exclusivas e Firebase em projetos distintos. PR [#111](https://github.com/EwertonMendes/roteiva-web/pull/111), commit publicado `d599e247e9858afe26c9f93e7bd0da70af870dee`.

| Ambiente | Frontend | API | Estado |
|---|---|---|---|
| DEV | https://roteiva-web-dev.web.app | https://roteiva-api-dev.roteiva-dev.workers.dev | Migrado; usuários, Firestore, D1 e credenciais preservados |
| PROD | https://roteiva.com | https://api.roteiva.com | Publicado; schema e serviços isolados, sem dados de negócio |

[Primeira promoção PROD](https://github.com/EwertonMendes/roteiva-web/actions/runs/43023457363) aprovada e concluída por delegação expressa do proprietário, com regressão completa e dois ambientes protegidos. Manifestos dos dois frontends confirmam o mesmo SHA e os respectivos destinos. `PRODUCTION_ENABLED` voltou a false após a publicação; promoções futuras continuam manuais e protegidas.

**VALIDADO:** migração DEV com 25 tabelas/99 registros comparados antes do selo novo, Google Drive real reconectado/listando, Dropbox existente listando e abrindo PDF. Em PROD, identidades sintéticas provaram isolamento Firestore A/B/anônimo e rejeição de JWT entre projetos nas duas direções. Fixtures da primeira homologação removidas; naquele ponto Auth/Firestore ficaram vazios e D1 sem dados de negócio. Depois, a conta real do proprietário foi criada em PROD pelo fluxo Google/cadastro, com espaço vazio. Smokes de saúde/CORS/auth/cache e recuperação do SQL PROD passaram. Nenhum faturamento habilitado.

**Integrações para lançamento amplo:** Google login/Drive com marca verificada e publicada, callbacks e URLs próprias. Acesso aos escopos Drive ainda requer análise distinta. Dropbox com callback/site atualizados, aguardando ícones enviados manualmente pelo proprietário e solicitação/aprovação de produção. Conexões existentes e login no domínio novo foram conferidos; homologação completa de arquivos com usuários externos e Safari/iOS físico continua separada. drive.readonly permanece por necessidade funcional e pode exigir avaliação externa; nenhum custo novo foi habilitado. Consulte [DEVELOPMENT](docs/DEVELOPMENT.md) e o [roadmap](docs/MVP-ROADMAP.md).

As descrições abaixo conservam contexto histórico das respectivas entregas; o estado atual dos ambientes está nesta seção e no roadmap.

**Correções de mídia e capas (PR #109):** visualização PDF com páginas/zoom no painel e portal, ampliação de imagens no tamanho final, capas de projeto Drive/Dropbox com recorte persistido, busca compacta e retorno à listagem de aprovações com modal fechado. Resultados de testes e situação da publicação/homologação ficam no [roadmap](docs/MVP-ROADMAP.md).

**Detalhes do projeto:** conteúdo reorganizado com checklist compacto e progresso, financeiro com lançamentos editáveis, agenda e acesso aos materiais vinculados no Drive pela Biblioteca. Compatível com claro/escuro e celular; lateral preservada. QA automatizado e limites da homologação no [roadmap](docs/MVP-ROADMAP.md).

> **Aprovações:** o fluxo MVP está implementado e passou pela regressão automatizada local na [PR #55](https://github.com/EwertonMendes/roteiva-web/pull/55), ainda draft. Consulte [docs/REVIEWS-MVP.md](docs/REVIEWS-MVP.md) para resultados, segurança e aceite. A integração foi publicada no DEV existente para homologação, por autorização do proprietário e sem merge; os fluxos centrais foram homologados com Google Drive real, com limitações de Picker/dispositivos explicitadas no documento.

**Gestão de produção audiovisual para freelancers e pequenos estúdios.**

Frontend único **React 19 + Vite 8 + TypeScript**. [DEV](https://roteiva-web-dev.web.app/) · demonstração local: `pnpm dev --mode demo`.

A [PR #6](https://github.com/EwertonMendes/roteiva-web/pull/6) implementa a fundação Firebase DEV: login Google, logout, restauração de sessão e clientes, projetos, tarefas, entregas recorrentes, agenda, financeiro e tema persistidos por usuário. **PUBLICADO no DEV; testes automatizados validados. Login Google e persistência conferidos em uma conta real; QA da segunda conta e dispositivos ainda em andamento.** O estado detalhado e as evidências estão no [roadmap](docs/MVP-ROADMAP.md).

| Ambiente | Build | Persistência |
|---|---|---|
| Firebase DEV — `roteiva-web-dev` | `pnpm build` → `dist/` | Firebase Auth Google + Firestore Standard, São Paulo |
| Firebase PROD — `roteiva-web-prod` | `pnpm build:prod` → `dist/` | Publicado; recursos próprios, sem dados de negócio |
| Demo local (sem publicação) | `pnpm build:demo` → `dist-demo/` | Sem login; armazenamento local isolado |
| Emuladores | `pnpm build:emulator` | Projeto fictício `demo-roteiva`, nunca DEV real |

O modo é uma configuração explícita `VITE_APP_MODE`; não depende do domínio. Um novo usuário Firebase começa vazio. **Nenhum dado antigo da demonstração é importado automaticamente.** Domínios têm localStorage separado.

**Cadastro separado (PR #9):** o login Google autentica a identidade, mas **não cria mais automaticamente o perfil no Firestore**. Quem já possui `users/{uid}` entra diretamente, mantendo todos os dados. Quem escolhe **Criar conta** passa pelo cadastro curto com nome profissional, estúdio opcional, tipo de atuação e confirmação de entendimento do uso de dados DEV; só então é gravado o perfil e liberado o dashboard. Entrar com Google sem cadastro mostra uma opção explícita de criar espaço ou sair. O modo demo local permanece sem login.

## Desenvolvimento e testes

Node.js 22.13+, PNPM 11.25.0; Java 21 para emuladores.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm build:demo
pnpm build:emulator
pnpm exec playwright install chromium
pnpm test:firebase
```

`pnpm dev` inicia a demo. Para testar o DEV real, copie `.env.example` para `.env.local`, preencha a configuração pública e execute `pnpm dev --mode firebase`. Consulte [desenvolvimento](docs/DEVELOPMENT.md) para variáveis, segurança e deploy. Não inserir credenciais administrativas em variáveis `VITE_*`.

## Organização e segurança

- `src/features/auth/`: sessão, login e proteção da SPA.
- `src/features/workspace/`: carregamento, confirmação de gravação e recuperação de erros.
- `src/data/`: conversão tipada da UI e persistência por documento com detecção de conflito.
- `src/domain/workspace.ts`: contratos das telas, preservados.
- `users/{uid}`: perfil privado; subcoleções independentes para cada entidade.
- `firestore.rules`: isolamento pelo UID autenticado, validação de campos/tipos/limites, propriedade e timestamps imutáveis.
- `tests/`: regras nos emuladores com usuários A/B e testes Chromium desktop/mobile.
- `.github/workflows/`: validações rápidas independentes, DEV Firebase/Cloudflare e QA pesada separada.

O Firestore usa centavos inteiros e datas civis ISO, sem converter dias da agenda em horários UTC. Apenas documentos alterados são gravados. Erros de rede, permissão e conflito exigem recuperação explícita da versão da nuvem; não há fila de gravação privada em localStorage. O cache é gerenciado automaticamente pelo sistema; seu reuso depende da verificação de revisão por UID para evitar dados desatualizados. A reabertura consulta a revisão privada por UID e só reutiliza coleções persistidas com contagem completa e versão correspondente. O sincronismo por domínio acrescenta uma escrita por transação de negócio e não usa documento global compartilhado.

**PARCIAL — Google Drive DEV:** a integração Worker/D1/OAuth permite conectar uma conta com consentimento, vincular pastas a projetos e explorar seus arquivos. A [PR #52](https://github.com/EwertonMendes/roteiva-web/pull/52), integrada à master por autorização expressa e publicada no DEV pelos workflows oficiais, adiciona Picker e upload direto com fila; autorização de pasta existente e vídeo >250 MiB foram comprovados no Chrome DEV. Recuperação com rede real, Google A/B remoto, revogação/reconexão, Safari e dispositivo físico continuam pendentes em [DRIVE-UPLOAD.md](docs/DRIVE-UPLOAD.md). Filtros locais consideram itens carregados; busca remota permanece limitada à pasta. **PLANEJADO:** versões, revisão remota, equipes, cobrança e PROD. A tela de revisão continua explicativa. Login Google por si só não concede acesso ao Drive.


## Configurações do perfil e estúdio (PR #11)

No Firebase DEV, a área **Configurações** permite editar nome profissional, nome da marca/estúdio e tipo de atuação. O nome escolhido é usado nas configurações e nas aprovações, no lugar do rótulo genérico `Roteiva Studio` (usado somente quando não há nome cadastrado). E-mail e foto continuam gerenciados pelo Google, somente para leitura.

O perfil é salvo no próprio `users/{uid}` do Firestore com revisão sequencial verificada em transação; alterações concorrentes produzem erro de conflito, não perda silenciosa. Usuários antigos continuam acessando seus dados; para eles, a área acrescenta somente os campos opcionais de estúdio e ocupação, **sem inventar datas ou aceite de cadastro**. O tema continua em `users/{uid}/preferences/ui`. Exportação JSON dos registros **carregados** é reutilizada, sem incluir mídia/credenciais.

**Fora deste PR:** exclusão irreversível de conta, edição de foto/e-mail do Google, políticas legais, billing, Drive e trabalho em equipe. A demonstração local continua sem conta e mostra as configurações em modo leitura.

**Exclusão permanente (PR #30):** publicada e verificada no DEV com conta de teste autorizada: dados e identidade removidos, concessão Drive revogada, arquivo original preservado e outra conta intacta. A [PR #31](https://github.com/EwertonMendes/roteiva-web/pull/31) corrige o acompanhamento da conclusão, o orçamento de execução e a linguagem ao cliente; exclusão fica apenas em Configurações após cadastro. Login recente é aproveitado na confirmação; uma sessão antiga exige confirmar a mesma conta com Google, sem aceitar outra identidade. Veja os resultados e aceites ainda pendentes em [ACCOUNT-DELETION.md](docs/ACCOUNT-DELETION.md).

## Navegação com URLs persistentes (PR #12)

O Firebase DEV utiliza caminhos reais para as telas internas (`/projetos`, `/clientes`, `/financeiro`, `/calendario`, `/biblioteca`, `/aprovacoes`, `/configuracoes`) e para detalhes de projetos e clientes (`/projetos/:id`, `/clientes/:id`). A URL sobrevive ao F5, pode ser usada como link e respeita Voltar/Avançar. `/review` permanece uma página separada e protegida.

O modo demo local mantém sua chave histórica de localStorage, mas não é publicado no GitHub Pages. Links de registros privados **não concedem acesso**: Firebase Auth e Security Rules continuam exigindo o proprietário.

## Documentação

- [Arquitetura e decisões](docs/ARCHITECTURE.md)
- [Roadmap, critérios de aceite e evidências](docs/MVP-ROADMAP.md)
- [Desenvolvimento e deploy](docs/DEVELOPMENT.md)
- [Design e responsividade](docs/DESIGN.md)
- [Instruções permanentes](AGENTS.md)

O projeto permanece no **Spark**. Franquias têm limites; nenhuma habilitação de Blaze ou serviço pago faz parte desta entrega.


**Economia de consultas (PR #13, em validação):** a Visão Geral usa contagens agregadas e até quatro projetos recentes com tarefas vinculadas, em vez do histórico inteiro de projetos e lançamentos. As listas de Projetos e Clientes possuem paginação real no Firestore (24 por vez) e Carregar mais; Projetos filtra status no servidor, e buscas textuais carregam o domínio completo para não omitir resultados. Ações de negócio gravam documentos específicos por comandos tipados, sem persistir o workspace inteiro por efeito React; a demonstração continua com localStorage. Configurações não baixa coleções de negócio e a exportação busca os dados completos. **Financeiro:** a abertura carrega somente o mês atual; o gráfico anual usa somas agregadas por mês (com leitura completa de até 40 lançamentos como caminho mais econômico), e mudar mês, ano ou cliente consulta a janela necessária. **Agenda:** carrega os três meses que cobrem a grade e até quatro compromissos futuros, sem baixar o histórico. O diagnóstico da sessão aparece em Configurações, mas não corresponde ao consumo faturável; a confirmação de economia requer métricas do Console Firebase DEV.

**Configurações (Zona de perigo e cache automático):** a exclusão permanente fica em uma seção isolada e vermelha; os controles técnicos de cache e exportação parcial deixam de aparecer. O cache do Firestore é automático e seu reaproveitamento depende de revisão remota, contagem consistente e UID, sem prometer dados offline atuais. O logout tenta limpar a persistência local; em outros dispositivos essa limpeza não pode ser garantida remotamente.

## Pipelines rápidas e operações administrativas (CI/CD 2026-10-18)

Frontend e API validam alterações de forma independente; commits na `master` publicam em Firebase Hosting DEV e Cloudflare Worker DEV sem passar pelo antigo GitHub Pages. Regras e índices Firestore têm workflow específico, com testes de isolamento A/B. Playwright completo roda via QA noturna ou manual, sem bloquear alterações visuais rotineiras. Previews de PR são manuais e temporários, publicados apenas no canal de preview do Firebase DEV.

`firebase-ops.yml` implementa consultas restritas e fixtures de manutenção, mas fica **bloqueado enquanto o repositório for público**, ou sem a conta administrativa dedicada e habilitação explícita no ambiente `firebase-data-development`. Não existe acesso administrativo liberado aos documentos reais em Actions públicos. Escritas arbitrárias em registros de clientes não são permitidas, pois contornariam regras, revisões e stamps da aplicação. Consulte [DEVELOPMENT](docs/DEVELOPMENT.md).

A configuração PROD é somente um modelo, sem ambiente/credenciais provisionados nem workflow habilitado. Os tempos de 1 minuto são metas, não garantias para migrações, emuladores ou filas do GitHub.


## Miniaturas e visualização da Biblioteca

O Roteiva mostra miniaturas fornecidas pelo Google Drive para mídia quando disponíveis, com modos **Lista** e **Grade**, e modal de visualização ampliada no Google Drive. Miniaturas privadas passam por uma rota curta e autenticada do Worker, sob demanda e em memória; vídeos não são transferidos pelo Worker. Documentos sem thumb mantêm ícone do tipo. O preview integrado exige origem DEV principal devido a Auth/CORS, portanto a validação funcional deve ocorrer após deploy conjunto de frontend e API.


### Google Drive mais rápido — DEV

A Biblioteca reaproveita listagens recentes por sessão e busca nomes remotamente dentro da pasta, com paginação; miniaturas utilizam tickets autenticados de curta duração, evitando uma segunda consulta Google para cada arquivo. A fila prioriza imagens visíveis e conserva o cache em memória ao navegar entre telas. O conteúdo dos arquivos permanece no Drive e não é copiado para Firestore/D1.

**Controle comercial (rollout DEV):** teste gratuito de sete dias, sem cartão ou cobrança automática, provisionado no backend. Contas beta anteriores à migração recebem cortesia separada de 30 dias. A publicação ocorre em fases; integração da UI, restrição definitiva das regras e homologação remota têm estados separados em [ACCESS-CONTROL.md](docs/ACCESS-CONTROL.md).


**Teste gratuito único (PR #51, publicado em DEV):** sete dias por identidade Google/e-mail verificado elegível; excluir e recriar a conta não concede outro período. Marcadores HMAC pseudonimizados permanecem após a exclusão para essa finalidade. O prazo beta de 30 dias continua fixo. Publicação/homologação DEV rastreada no [roadmap](docs/MVP-ROADMAP.md), com detalhes e limites em [TRIAL-REUSE-PREVENTION.md](docs/TRIAL-REUSE-PREVENTION.md).

**Exclusão da conta:** disponível somente em Configurações → Zona de perigo para usuários com acesso ativo. Telas de acesso expirado, suspensão, cadastro ou erro de validação não oferecem a ação; o backend também bloqueia novos pedidos sem acesso ativo.

## Projetos e capas do Drive

A listagem de Projetos usa cards com filtros e ícones de situação coloridos. Com o Drive conectado, é possível escolher uma imagem privada (JPG, PNG, WebP ou AVIF, até 8 MB), reposicionar por arraste, ajustar o zoom com roda do mouse ou pinça e salvar o enquadramento no projeto. Sem conexão, fotos e controles de capa ficam ocultos. A imagem original permanece no Drive.

A barra lateral reúne as rotas do espaço de trabalho. O menu de reticências junto ao perfil oferece troca de tema e logout; o histórico de atividades fica no dashboard.
