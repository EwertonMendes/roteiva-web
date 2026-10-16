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
- Trabalhar em branch + PR e preservar a demonstração existente enquanto a migração for realizada. Não fazer mudanças destrutivas em produção, banco, pastas do Drive ou dados reais sem autorização.
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

- O frontend **Next.js/Vinext é parte da estrutura aprovada e deve ser preservado**. A versão Pages em `pages/` usa os mesmos componentes em modo demonstração com `localStorage`.
- Na PR #4 foram removidas APIs de negócio D1/R2/Drizzle e conectores antigos; o `build/sites-worker.ts` continua **somente como renderizador Vinext**. **Não remover Next/Vinext, seus scripts, layouts ou componentes sem solicitação explícita.**
- Firebase + Worker API/D1 (tokens) + Drive individual é **objetivo futuro** e ainda não implementado. A remoção do backend legado não autoriza refatorar o frontend nem alterar a experiência.
- O BRBET antigo é referência conceitual, não uma dependência e não deve ser copiado cegamente; verificar direitos de reutilização antes de aproveitar código.
- O escopo `drive.file` é o padrão desejado; **não pedir acesso irrestrito ao Drive** por conveniência.
- Com uploads grandes, dados passam diretamente do navegador ao Drive quando a prova de conceito confirmar segurança e CORS; **não passar vídeo pelo Worker**.
- Refresh tokens só no backend criptografados; acesso entre workspaces sempre verificado no servidor/regras.

**Definição de pronto:** código revisado + testes aplicáveis + critérios de aceite + segurança relevante + documentação sincronizada. A documentação é parte da entrega, não um trabalho posterior.
