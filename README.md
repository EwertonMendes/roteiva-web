# Roteiva

**Gestão de produção audiovisual para freelancers e pequenos estúdios.**

O Roteiva reúne, inicialmente em **modo demonstração**, clientes, projetos, tarefas, agenda e financeiro. A biblioteca de vídeos no Drive do usuário e o fluxo de revisões serão implementados nas próximas etapas do MVP.

> **Estado em 16/10/2026:** frontend **React 19 + Vite 8 + TypeScript**, pronto para gerar um site estático para **Firebase Hosting**. Sem Next.js, Vinext, servidor próprio, banco, login ou upload remoto. A interface atual e os dados locais de demonstração foram preservados; **não utilize dados sensíveis ou de clientes reais**.

**[Abrir demonstração no GitHub Pages](https://ewertonmendes.github.io/roteiva-web/)**

## Começar

Requisitos: Node.js 22.13+ e PNPM 11.25.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Validação e build:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm preview
```

O build de produção gera a pasta **`dist/`**, pronta para Firebase Hosting na raiz do domínio. A demonstração existente no GitHub Pages usa os **mesmos componentes** e é compilada com `pnpm build:pages` para `dist-pages/` sob `/roteiva-web/`.

## Estrutura atual

```text
index.html                   Entrada única React
src/                         Componentes, estilos e regras locais
public/                      Logos, favicon, fontes Ubuntu e licença
assets/brand/                Fonte original da marca (fora do deploy)
tests/                       Testes da agenda e do financeiro
scripts/verify-static-build.mjs  Validação de artefatos Firebase/Pages
vite.config.ts               Configuração única de build frontend
firebase.json                Configuração Firebase Hosting (somente Hosting)
.github/workflows/           CI e deploy do Pages; deploy Firebase manual
docs/                        Arquitetura futura e roadmap
```

O aplicativo salva os dados somente no `localStorage` com a chave `roteiva-pages-demo-workspace-v1` (preservada para não perder dados anteriores no mesmo navegador e origem). **Domínios diferentes têm localStorage separado**: os dados existentes no Pages **não aparecerão automaticamente** em um domínio Firebase.

Recursos ainda **não disponíveis**: autenticação Firebase, Firestore, backend Worker, upload do Drive, revisão compartilhada e sincronização em nuvem. A tela de revisão explica essa limitação.

## Firebase Hosting

O `firebase.json` já aponta para `dist/`, tem fallback de SPA para `/index.html` e cache longo somente para assets com nomes versionados. **Falta apenas vincular um projeto Firebase e autenticar o deploy**.

```bash
pnpm build
pnpm dlx firebase-tools login
pnpm dlx firebase-tools deploy --only hosting --project SEU_PROJECT_ID
```

O `SEU_PROJECT_ID` é o ID real do projeto Firebase escolhido, não um identificador de exemplo a manter. Também há o workflow manual **Deploy Firebase Hosting**, que requer a variável `FIREBASE_PROJECT_ID` e o segredo `FIREBASE_SERVICE_ACCOUNT` no GitHub. **Nada é publicado automaticamente no Firebase antes dessas configurações.** Consulte [guia de desenvolvimento e deploy](docs/DEVELOPMENT.md).

## Próxima arquitetura (planejada)

| Camada | Tecnologia futura |
|---|---|
| Site | Firebase Hosting — configuração estática já preparada |
| Login | Firebase Authentication com Google |
| Dados de negócio | Cloud Firestore + Security Rules |
| API privilegiada e OAuth | Cloudflare Workers |
| Tokens OAuth protegidos | Workers Secrets e Cloudflare D1 |
| Vídeos e mídias | Google Drive individual de cada profissional |

As integrações futuras **não fazem parte do build atual**. Consulte [arquitetura](docs/ARCHITECTURE.md) e [roadmap](docs/MVP-ROADMAP.md).

## Documentação

- [Arquitetura e decisões técnicas](docs/ARCHITECTURE.md)
- [Roadmap vivo do MVP](docs/MVP-ROADMAP.md)
- [Desenvolvimento, testes e deploy Firebase](docs/DEVELOPMENT.md)
- [Design e responsividade](docs/DESIGN.md)
- [Regras permanentes para IAs e contribuidores](AGENTS.md)

Contribuições devem passar por PR, com testes e documentação atualizados na mesma alteração.
