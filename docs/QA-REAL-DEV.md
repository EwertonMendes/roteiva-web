# QA Real DEV — Playwright, execução **somente manual**

A suíte `.github/workflows/qa-real-dev.yml` tem **apenas** `workflow_dispatch`. Não é disparada por push, PR, agenda, merge ou deploy. Não utiliza Miniflare, D1 local, Firebase Emulator, API mockada, nem configuração `playwright.config.ts` do ambiente simulado.

## Executar

GitHub → Actions → **QA Real DEV (manual only)** → Run workflow (branch `master`) → `smoke`, `authenticated` ou `full`.

- `smoke`: publicado real, sem login — endpoints protegidos rejeitam tokens inválidos, rotas SSR/SPA renderizam e não expõem projetos de outros usuários, link público inexistente é negado. Desktop + mobile. **Executável sem segredos.**
- `authenticated`: executa smoke e abre o DEV publicado com **uma conta Google exclusiva de QA**. Testa atualização de rotas, Biblioteca ligada ao Google Drive, busca de aprovações com debounce e modal de criação sem publicar.
- `full`: acima + upload de um PNG único para pasta dedicada Roteiva QA, confirmação de persistência no backend e envio do arquivo **criado pelo próprio teste** para a lixeira via Google Drive API. Não envia para outras pastas. Exige credencial de limpeza para iniciar.

**Resultados:** consulte a execução do workflow. Falhas produzem screenshots da conta dedicada de QA (artefatos privados, retenção 1 dia); não produzimos traces de sessões autenticadas porque eles podem conter refresh tokens. Não incluímos credenciais ou storage state nos artefatos.

## Preparar a conta exclusiva — uma única vez

1. Criar uma conta Google separada que será usada **somente para QA**; entrar no Roteiva DEV e finalizar seu cadastro. Nunca usar a conta pessoal, real dos sócios ou de clientes.
2. Criar um projeto e uma pasta no Google Drive chamada `Roteiva QA ...`, conectá-la e vinculá-la somente a esse projeto QA. A conta precisa ter acesso ativo ao Roteiva; se estiver expirada, o teste falhará em vez de forçar elegibilidade.
3. Para capturar o login: `QA_EXPECTED_EMAIL=<email-da-conta-qa> node scripts/qa-live/capture-auth.mjs` (terminal Windows: definir variável de ambiente via `$env:QA_EXPECTED_EMAIL='...'`; exige Chromium instalado por `pnpm exec playwright install chromium`). Após entrar no navegador aberto, pressione Enter.
4. O script cria `storage-state.json` em pasta temporária **fora** do repositório. Ele contém tokens sensíveis e deve ser codificado em base64, instalado no GitHub Secret `QA_STORAGE_STATE_B64` do ambiente `firebase-development`, e apagado localmente. **Nunca colar sessão, refresh tokens nem credenciais em commits, PRs ou neste chat.**
5. Configurar GitHub Environment Variables do ambiente `firebase-development`: `QA_EXPECTED_EMAIL`, `QA_DRIVE_FOLDER_NAME` (começa literalmente por `Roteiva QA`). A suíte só abre a pasta cujo nome corresponda exatamente à variável.
6. Para a suíte `full`, usar a **mesma conta QA** para obter token OAuth refresh com escopo `drive.file`, client ID e client secret apropriados. Definir `QA_GOOGLE_CLIENT_ID` como variável; `QA_GOOGLE_CLIENT_SECRET` e `QA_DRIVE_REFRESH_TOKEN` como secrets do ambiente. O refresh token deve poder modificar somente os arquivos que a aplicação de QA criou. Não utilizar tokens de produção.
7. Rotacione/recrie o estado de autenticação se expirar ou for revogado.

## Segurança, limitações e evidências

- Nenhum teste escreve dados reais durante `smoke` ou `authenticated`; somente `full` escreve um PNG numa pasta dedicada e efetua rollback na lixeira. O arquivo pode permanecer na pasta QA se houver falha antes de receber o ID do backend; neste caso, é necessário limpar a pasta QA ao investigar o teste.
- O teste não gera uma conta/cadastro automaticamente nem tenta contornar OAuth/CAPTCHA. Google exige uma primeira autorização legítima.
- Sem estado de login do QA, os testes autenticados não são considerados aprovados: o workflow encerra com **BLOCKED** explícito, e o smoke mantém seu resultado próprio.
- O teste de aprovação abre o composer, mas **não envia uma aprovação**, por não haver ainda rotina de limpeza para registros reais de revisão. Para testar o fluxo de aprovação/revisão sem deixar dados persistentes, criar fixture isolada com coleta de IDs, revogação de grants e uma rota/rotina administrativa controlada de limpeza de dados QA.
- Compare as métricas de Workers/D1 em janelas UTC/BRT equivalentes após os testes; o workflow não afirma ganhos de CPU/custo sozinho.
- Não adicionar agendamento automático sem decisão explícita. Deploys existentes permanecem intocados.
