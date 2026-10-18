# Instruções permanentes para IAs e contribuidores — Roteiva

Este arquivo é o ponto de entrada de instruções para agentes que atuam neste repositório. Leia **antes** de alterar código, infraestrutura ou documentação.

## Fontes de verdade

1. `README.md`: visão do produto e estado atual, sem reivindicar funcionalidades não entregues.
2. `docs/ARCHITECTURE.md`: arquitetura-alvo, contratos, segurança, decisões e questões ainda abertas.
3. `docs/MVP-ROADMAP.md`: **fonte de verdade do progresso** com etapas, dependências, aceite e evidências.
4. `docs/DEVELOPMENT.md`: comandos realmente válidos, ambientes, CI/deploy e testes.
5. `docs/DESIGN.md`: design system e regras de UX.

Não recrie READMEs concorrentes, documentos de teste avulsos ou planos paralelos com status divergentes. Prefira atualizar a seção existente e adicionar links cruzados. Somente separe um novo documento quando o assunto for grande, duradouro e realmente independente.

## Regras não negociáveis

- **Distinguir claramente:** `IMPLEMENTADO` (código e testes verificáveis), `PARCIAL`, `PLANEJADO`, `BLOQUEADO` e `VALIDADO` (critério de aceite cumprido). Uma tela visível não prova uma integração concluída.
- **A cada PR com alteração funcional:** revisar `docs/MVP-ROADMAP.md`. Marcar itens concluídos **somente** após implementação e verificação. Registrar evidência (caminho, teste, PR/commit ou procedimento manual).
- Se mexer em fluxo, persistência, autenticação, modelos, provedores, permissões, armazenamento ou deploy, atualizar `docs/ARCHITECTURE.md` no **mesmo PR**. Corrigir comandos em `docs/DEVELOPMENT.md` quando mudarem. Corrigir o README se o estado público do sistema mudar.
- Documentar novas decisões como **decisão tomada**, **hipótese em validação** ou **em aberto**; explicitar motivo, consequências e alternativas importantes. Não transformar sugestões em funcionalidades existentes.
- Antes de iniciar uma etapa, consultar dependências e critérios de aceite no roadmap; adicionar testes e regras de segurança necessários; registrar bloqueios encontrados.
- Ao concluir, revisar links Markdown, comandos e caminhos; apagar/redirecionar material redundante; não deixar instruções antigas afirmando o oposto das novas.
- Não fazer merge de recursos críticos sem validar isolamento entre usuários, autenticação, autorização e tratamento de erros. Não inferir segurança a partir de filtros só no frontend.
- Manter código limpo, modular, tipado e reutilizável. Evitar gambiarras, duplicação de estado e chamadas Firestore desnecessárias. Compatibilidade desktop/mobile e temas claro/escuro são requisitos.
- Trabalhar em branch + PR e preservar o modo demo local; o deploy histórico do GitHub Pages está descontinuado. Não fazer mudanças destrutivas em produção, banco, pastas do Drive ou dados reais sem autorização.
- **Nunca versionar** tokens, refresh tokens, chaves privadas, credenciais, arquivos sensíveis de clientes ou exemplos contendo segredos reais.

## Checklist obrigatório da IA para cada PR

- [ ] Descrever **o que mudou** e **o que continua pendente**.
- [ ] Atualizar itens relevantes de `docs/MVP-ROADMAP.md` com status e evidências.
- [ ] Atualizar `docs/ARCHITECTURE.md` se contratos/decisões/fluxos mudaram; ou justificar ausência.
- [ ] Atualizar `docs/DEVELOPMENT.md` se comandos, dependências, variáveis ou CI/deploy mudaram.
- [ ] Atualizar `README.md` se alterou o produto que pode ser testado/utilizado.
- [ ] Rodar os testes aplicáveis; documentar os que não puderam ser executados.
- [ ] Validar ameaças, regras Firestore, limites e separação de contas em mudanças de Auth/Drive/D1.
- [ ] Garantir que nenhuma feature apenas planejada seja apresentada como pronta.

## Atenção ao estado atual

- O frontend foi **explicitamente migrado na PR #5 para React + Vite + TypeScript** a fim de atender ao Firebase Hosting estático. A entrada é `index.html` e o código da UI está em `src/`. **Não recriar Next.js/Vinext, SSR nem backend por conveniência**.
- Existe **um único frontend**. `pnpm build` gera `dist/` para Firebase; `pnpm build:demo` fornece apenas um build de QA local. GitHub Pages não é usado nem deve ser reintroduzido.
- A fundação Firebase DEV da PR #6 usa somente roteiva-web-dev (Spark, Standard/nativo em São Paulo), Auth Google e subcoleções privadas users/{uid}. Conferir validação no roadmap. A PR #15 adiciona a fundação Worker/D1 DEV em api/; OAuth real, biblioteca Drive e PROD continuam pendentes. Mudanças de integração não autorizam redesenho.
- O BRBET antigo é referência conceitual, não uma dependência e não deve ser copiado cegamente; verificar direitos de reutilização antes de aproveitar código.
- O escopo `drive.file` é o padrão desejado; **não pedir acesso irrestrito ao Drive** por conveniência.
- Com uploads grandes, dados passam diretamente do navegador ao Drive quando a prova de conceito confirmar segurança e CORS; **não passar vídeo pelo Worker**.
- API em api/ usa npm ci/package-lock próprios; frontend preserva PNPM/lockfile. A PR #17 prepara uma PoC de conexão Drive em DEV usando navegador top-level para cookie seguro; OAuth ativado em DEV para usuários Google Testing, sujeito a consentimento real e QA Chrome/Safari. Não afirmar que o Drive completo está pronto. Não reutilizar o bootstrap temporário da PR #15: environment cloudflare-development aceita somente master, pipeline DEV da API valida de forma independente; não bloquear Worker em Playwright do frontend. Nenhuma infraestrutura PROD autorizada.
- Refresh tokens só no backend criptografados; acesso entre workspaces sempre verificado no servidor/regras.

- A chave de demonstração `roteiva-pages-demo-workspace-v1` é um contrato de compatibilidade local; não alterá-la sem migração de dados. LocalStorage não é compartilhado entre domínios diferentes.
- Deploy DEV exige FIREBASE_PROJECT_ID=roteiva-web-dev e FIREBASE_SERVICE_ACCOUNT protegido no Actions. Config SDK VITE_FIREBASE_* é pública; credencial administrativa nunca é frontend. DEV automático após validação rápida do respectivo componente em master; PROD não existe neste escopo.
- Preservar modos explícitos demo/firebase e projeto fictício demo-roteiva nos emuladores. Não detectar modo por domínio nem importar demo automaticamente. Cache persistente passou a ser automático no produto (PR #34); revalidar revisão/UID antes de aproveitar os dados e preservar isolamento e limpeza no logout.
- Alterações Firestore exigem testes A/B nos emuladores, validação create/update, revisão/timestamps e apenas gravações por documento. Financeiro e Agenda consultam janelas ISO, não histórias integrais; totais financeiros mensais/CSV devem sempre refletir o mês completo e agregações anuais devem considerar o filtro de cliente. O cache de janela não representa um domínio completo; conferir índices antes do deploy DEV. Nenhuma permissão/plano se baseia em campos livremente enviados pela UI.

**Definição de pronto:** código revisado + testes aplicáveis + critérios de aceite + segurança relevante + documentação sincronizada. A documentação é parte da entrega, não um trabalho posterior.

## Contrato de CI/CD atualizado (18/10/2026)

- CI rápido de frontend e backend é independente, com deploy DEV no respectivo ambiente após validação. Nunca restaurar o `workflow_run` dependente de Pages.
- Regras e índices só são publicados pelo workflow Firestore, depois dos testes A/B. Browser E2E completo é noturno/manual; mudanças críticas exigem revisão específica antes do merge.
- Os workflows DEV validam project ID e branch/SHA; não usar identidade de deploy como credencial de leitura/escrita de documentos.
- `firebase-ops.yml` é **fail-closed em repositório público**, só aceita leitura de documentos e contagens em `users/{uid}`, além de fixtures isoladas; escrita em dados de negócio exige operações de domínio auditadas e próprias, não patch genérico.
- PROD é modelo de configuração, não infraestrutura autorizada. Nenhum deploy ou acesso administrativo PROD está habilitado.
