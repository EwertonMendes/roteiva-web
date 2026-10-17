# Roteiva

**Gestão de produção audiovisual para freelancers e pequenos estúdios.**

Frontend único **React 19 + Vite 8 + TypeScript**. [DEV](https://roteiva-web-dev.web.app/) · [Demonstração sem login](https://ewertonmendes.github.io/roteiva-web/).

A [PR #6](https://github.com/EwertonMendes/roteiva-web/pull/6) implementa a fundação Firebase DEV: login Google, logout, restauração de sessão e clientes, projetos, tarefas, entregas recorrentes, agenda, financeiro e tema persistidos por usuário. **PUBLICADO no DEV; testes automatizados validados. Login Google e persistência conferidos em uma conta real; QA da segunda conta e dispositivos ainda em andamento.** O estado detalhado e as evidências estão no [roadmap](docs/MVP-ROADMAP.md).

| Ambiente | Build | Persistência |
|---|---|---|
| Firebase DEV — `roteiva-web-dev` | `pnpm build` → `dist/` | Firebase Auth Google + Firestore Standard, São Paulo |
| GitHub Pages — demonstração | `pnpm build:pages` → `dist-pages/` | Sem login; localStorage `roteiva-pages-demo-workspace-v1` |
| Emuladores | `pnpm build:emulator` | Projeto fictício `demo-roteiva`, nunca DEV real |

O modo é uma configuração explícita `VITE_APP_MODE`; não depende do domínio. Um novo usuário Firebase começa vazio. **Nenhum dado antigo da demonstração é importado automaticamente.** Domínios têm localStorage separado.

**Cadastro separado (PR #9):** o login Google autentica a identidade, mas **não cria mais automaticamente o perfil no Firestore**. Quem já possui `users/{uid}` entra diretamente, mantendo todos os dados. Quem escolhe **Criar conta** passa pelo cadastro curto com nome profissional, estúdio opcional, tipo de atuação e confirmação de entendimento do uso de dados DEV; só então é gravado o perfil e liberado o dashboard. Entrar com Google sem cadastro mostra uma opção explícita de criar espaço ou sair. O GitHub Pages continua sem login.

## Desenvolvimento e testes

Node.js 22.13+, PNPM 11.25.0; Java 21 para emuladores.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm build:pages
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
- `.github/workflows/`: CI/Pages e publicação DEV após CI verde na master.

O Firestore usa centavos inteiros e datas civis ISO, sem converter dias da agenda em horários UTC. Apenas documentos alterados são gravados. Erros de rede, permissão e conflito exigem recuperação explícita da versão da nuvem; não há fila de gravação privada em localStorage. O cache persistente é opt-in em Configurações e contém registros privados neste dispositivo; por padrão usa memória. A reabertura consulta a revisão privada por UID e só reutiliza coleções persistidas com contagem completa e versão correspondente. O sincronismo por domínio acrescenta uma escrita por transação de negócio e não usa documento global compartilhado.

**PLANEJADO:** Google Drive, upload de mídia, revisão remota, Worker/D1 de OAuth, equipes, cobrança e PROD. A tela de revisão continua explicativa. A autenticação Google não concede acesso ao Drive.


## Configurações do perfil e estúdio (PR #11)

No Firebase DEV, a área **Configurações** permite editar nome profissional, nome da marca/estúdio e tipo de atuação. O nome escolhido aparece automaticamente no topo e na lateral do painel, no lugar do rótulo genérico `Roteiva Studio` (usado somente quando não há nome cadastrado). E-mail e foto continuam gerenciados pelo Google, somente para leitura.

O perfil é salvo no próprio `users/{uid}` do Firestore com revisão sequencial verificada em transação; alterações concorrentes produzem erro de conflito, não perda silenciosa. Usuários antigos continuam acessando seus dados; para eles, a área acrescenta somente os campos opcionais de estúdio e ocupação, **sem inventar datas ou aceite de cadastro**. O tema continua em `users/{uid}/preferences/ui`. Exportação JSON dos registros **carregados** é reutilizada, sem incluir mídia/credenciais.

**Fora deste PR:** exclusão irreversível de conta, edição de foto/e-mail do Google, políticas legais, billing, Drive e trabalho em equipe. A demonstração Pages continua sem conta e mostra as configurações em modo leitura.

## Navegação com URLs persistentes (PR #12)

O Firebase DEV utiliza caminhos reais para as telas internas (`/projetos`, `/clientes`, `/financeiro`, `/calendario`, `/biblioteca`, `/aprovacoes`, `/configuracoes`) e para detalhes de projetos e clientes (`/projetos/:id`, `/clientes/:id`). A URL sobrevive ao F5, pode ser usada como link e respeita Voltar/Avançar. `/review` permanece uma página separada e protegida.

A mesma aplicação na demonstração GitHub Pages usa rotas em `#/...` sob `/roteiva-web/`, sem alterar a chave de localStorage nem exigir um backend/fallback indisponível no Pages. Links de registros privados **não concedem acesso**: Firebase Auth e Security Rules continuam exigindo o proprietário.

## Documentação

- [Arquitetura e decisões](docs/ARCHITECTURE.md)
- [Roadmap, critérios de aceite e evidências](docs/MVP-ROADMAP.md)
- [Desenvolvimento e deploy](docs/DEVELOPMENT.md)
- [Design e responsividade](docs/DESIGN.md)
- [Instruções permanentes](AGENTS.md)

O projeto permanece no **Spark**. Franquias têm limites; nenhuma habilitação de Blaze ou serviço pago faz parte desta entrega.


**Economia de consultas (PR #13, em validação):** a rota atual controla quais domínios são necessários; navegar para outra tela carrega apenas os domínios ainda ausentes. Configurações e Biblioteca não precisam ler clientes/projetos no primeiro acesso. A exportação JSON sempre busca o conjunto completo antes de gerar a cópia. A codificação para salvar restringe o diff aos domínios efetivamente alterados; as consultas ainda leem domínios completos, sem paginação visível por lista.
