# Roteiva

**Gestão de produções audiovisuais para freelancers e pequenos estúdios.**

O Roteiva pretende reunir clientes, projetos, entregas, agenda, financeiro, arquivos e aprovações em um único ambiente. A proposta é simplificar o trabalho de videomakers, editores, produtoras e profissionais independentes, mantendo os vídeos no **Google Drive do próprio usuário**.

> **Estado em 16/10/2026:** protótipo com interface navegável e uma demonstração pública **local ao navegador**. A arquitetura SaaS descrita abaixo é o **plano do MVP**, não uma infraestrutura já implantada. **Não use dados privados ou arquivos reais na demonstração pública.**

## Experimente a interface

**[Abrir demonstração no GitHub Pages](https://ewertonmendes.github.io/roteiva-web/)**

A demonstração usa React/Vite e `localStorage`: permite explorar cadastros e telas, mas **não possui autenticação real, sincronização entre usuários/dispositivos, banco remoto, upload nem aprovação pública funcional**. Consulte [Desenvolvimento e ambientes](docs/DEVELOPMENT.md).

## Escopo do produto

- Painel com prazos, atividades e pendências.
- Clientes recorrentes e avulsos; projetos, tarefas, modelos e entregas.
- Agenda de gravações, reuniões, entregas e revisões.
- Financeiro por cliente/projeto, receitas, despesas e parcelas.
- Biblioteca de mídias com versões e vínculo aos projetos.
- Revisão e aprovação de entregas por clientes convidados.
- Conta individual e, no futuro, colaboração e assinaturas.

**Status:** os componentes visuais/fluxos de protótipo existem em diferentes graus; os fluxos SaaS seguros e persistentes ainda serão implementados e validados. Veja o [roadmap vivo](docs/MVP-ROADMAP.md) para não confundir interface com produto pronto.

## Arquitetura de destino (planejada)

| Responsabilidade | Escolha para o MVP |
|---|---|
| Frontend | React + Vite + TypeScript, responsivo |
| Hospedagem web | Firebase Hosting |
| Identidade | Firebase Authentication, login Google |
| Dados de negócio | Cloud Firestore com regras por workspace |
| API e OAuth | Cloudflare Workers (TypeScript) |
| Segredos e credenciais OAuth | Workers Secrets |
| Refresh tokens criptografados | Cloudflare D1 |
| Arquivos grandes | Google Drive conectado individualmente por usuário |
| Integração contínua | GitHub Actions, com DEV/testes antes de produção |

**Sem servidor próprio ligado 24h e sem armazenar os vídeos do cliente em um bucket central do Roteiva.** A meta inicial é caber nas franquias gratuitas; cotas, disponibilidade e necessidades comerciais devem ser verificadas antes do lançamento. A [arquitetura detalhada](docs/ARCHITECTURE.md) diferencia decisões, hipóteses e provas de conceito pendentes.

## Situação técnica atual

O repositório **ainda não usa** a arquitetura acima. A implementação original é **Next.js/Vinext + React**, com rotas `app/api/**`, autenticação vinculada ao ambiente original, **Cloudflare D1/R2** e armazenamento de workspace como um objeto grande. O GitHub Pages compila somente uma entrada estática separada. Nada disso deve ser anunciado como um SaaS em produção.

A migração será **incremental**; preservar o comportamento existente durante a substituição dos serviços é obrigatório. Não remover código legado sem identificar sua substituição e testar os fluxos.

## Documentação

| Documento | Para que serve |
|---|---|
| [Arquitetura](docs/ARCHITECTURE.md) | Frontend, backend, bancos, Drive, OAuth, segurança, modelos, fluxos e decisões em aberto |
| [Roadmap do MVP](docs/MVP-ROADMAP.md) | Estado verificável, sequência de entregas, critérios de aceite e pendências |
| [Desenvolvimento](docs/DEVELOPMENT.md) | Instalação, comandos, testes, deploy da demonstração e ambientes futuros |
| [Design](docs/DESIGN.md) | Identidade visual, responsividade e acessibilidade |
| [Instruções para IAs](AGENTS.md) | Regras para contribuir e **atualizar a documentação junto de cada implementação** |

## Desenvolvimento rápido (estado atual)

Requer **Node.js 22.13+** e **PNPM 11.25.0** (versão utilizada no CI).

```bash
pnpm install --frozen-lockfile
pnpm run test:calendar
pnpm run test:finance
pnpm run build:pages
```

O código legado tem comandos próprios para um preview local com Vinext/D1/R2. Consulte [Desenvolvimento](docs/DEVELOPMENT.md) antes de executá-los. O projeto utiliza **PNPM 11.25.0** com apenas o lockfile `pnpm-lock.yaml`. Os instaladores e componentes genéricos do template original foram removidos; o código Vinext/D1/R2 ainda necessário ao legado permanece até sua migração.

## Contribuição

Use branches e pull requests. Toda mudança que implemente, remova ou altere uma funcionalidade precisa revisar o [roadmap](docs/MVP-ROADMAP.md), atualizar a [arquitetura](docs/ARCHITECTURE.md) quando necessário e registrar a validação no PR. Leia [AGENTS.md](AGENTS.md).

---
**Projeto em evolução — documentação atualizada em 16/10/2026.**
