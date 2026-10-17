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

O Firestore usa centavos inteiros e datas civis ISO, sem converter dias da agenda em horários UTC. Apenas documentos alterados são gravados. Erros de rede, permissão e conflito exigem recuperação explícita da versão da nuvem; não há fila de gravação privada em localStorage.

**PLANEJADO:** Google Drive, upload de mídia, revisão remota, Worker/D1 de OAuth, equipes, cobrança e PROD. A tela de revisão continua explicativa. A autenticação Google não concede acesso ao Drive.

## Documentação

- [Arquitetura e decisões](docs/ARCHITECTURE.md)
- [Roadmap, critérios de aceite e evidências](docs/MVP-ROADMAP.md)
- [Desenvolvimento e deploy](docs/DEVELOPMENT.md)
- [Design e responsividade](docs/DESIGN.md)
- [Instruções permanentes](AGENTS.md)

O projeto permanece no **Spark**. Franquias têm limites; nenhuma habilitação de Blaze ou serviço pago faz parte desta entrega.
