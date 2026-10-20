# QA E2E isolado — controle SaaS

## Objetivo e limites

A suíte de acesso testa **somente fixtures descartáveis** no Firebase Authentication Emulator e Firestore Emulator (`demo-roteiva`) com Playwright Chromium desktop e mobile. Ela **não** cria usuários no projeto `roteiva-web-dev`, não acessa o D1 remoto, não usa credenciais/segredos, não efetua cobrança nem publica código. O endpoint absoluto de DEV usado pela SPA é interceptado no navegador antes de qualquer chamada; no navegador, a integração de `/access/ensure` e o processamento de exclusão são simulados. Os testes de Worker/D1 executam separadamente em Node com SQLite local e provedores simulados.

A cobertura contempla:

- **Expiração**: usuário novo e documentos privados reais no emulador, projeção vencida por privilégio de fixture, remoção da área privada da UI em sessão ativa, refresh/URL direta, falha de leitura das coleções e preservação do próprio perfil/status. O botão de reverificação não renova `trialEndsAt`. Conforme a PR #54, acesso expirado não oferece exclusão; a ação permanece somente nas Configurações do workspace ativo. A mensagem também impede apresentar exclusão/recadastro como renovação de trial.
- **Isolamento A/B**: duas identidades Google do emulador cadastradas pelo navegador, registros próprios criados pela UI, login/logout independente, Firestore Security Rules impedindo leituras e exclusões cruzadas, e vencimento de A sem afetar B.
- **Exclusão**: confirmação destrutiva real pela UI, POST interceptado, estado `deleting` e fence criados no Firestore Emulator, bloqueio de leitura/gravação do cliente, progresso exibido e conclusão simulada somente **após** limpar os documentos descartáveis via contexto administrativo do emulador. Esse teste verifica o contrato UI/status e gates; o apagamento da identidade Firebase e a saga D1/Cron são cobertos pelos testes isolados do Worker, não pelo fluxo de navegador.

## Executar e inspecionar

O workflow `.github/workflows/qa-isolated-e2e.yml` roda automaticamente em PRs que alteram os arquivos de acesso/segurança relevantes e aceita execução manual pelo GitHub Actions. Não requer secrets, ambientes protegidos nem merges para rodar em pull requests.

Localmente, com Node 22, pnpm 11, Java 21 e Chromium Playwright:

```bash
cd api && npm ci --ignore-scripts && npm run typecheck && npm test
cd ..
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build:emulator && pnpm build:demo
pnpm test:firebase
```

A última linha inicia e encerra os emuladores automaticamente, roda Firestore Rules e todos os testes Playwright. Falhas preservam traces/screenshots no artefato de CI por sete dias.

Na integração com master de 20/10/2026, o helper de logout passou a aguardar o
carregamento do documento após a limpeza do cache privado, antes de iniciar outra
identidade. Isso elimina a corrida de navegações observada no cenário A/B mobile,
sem sleeps, retries para ocultar falhas ou alteração do produto.

## Critérios de evidência

**CI isolado verde não substitui homologação remota** de expiração exata no Worker/Firestore real, isolamento com duas identidades reais ou conclusão de um job de exclusão em DEV. Não afirmar esses três critérios como homologados remotamente a partir destes testes. Para verificar infra remota sem uma sessão Google manual, seria necessário configurar uma identidade de teste automatizável, segregada e temporária e usar a API real com credenciais específicas do ambiente; esse provisionamento não é criado por esta PR.

Cortesia de 30 dias para a coorte DEV permanece inalterada; trial de novos usuários continua sete dias, sem renovação automática.
