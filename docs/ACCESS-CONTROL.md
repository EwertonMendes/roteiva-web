# Controle comercial do Roteiva — MVP (7 dias)

## Escopo confirmado
- **Único plano** com funcionalidades completas; periodicidades mensal, trimestral e anual são modelos de dados, **sem checkout/preços** nesta entrega.
- Teste **7 dias corridos**, sem cartão, começa no primeiro provisionamento do perfil registrado, uma vez por Firebase UID; refazer login não reinicia prazo.
- Cortesias com validade ou ilimitadas e suspensão são administráveis apenas por backend privilegiado **a ser consumido por um aplicativo de administração separado**. Não construir telas, rotas ou segredos ADM dentro do Roteiva.
- Suspensão/expiração: login, perfil e exclusão permanecem acessíveis; operações protegidas em Firestore e Drive deixam de funcionar. Não ocorre exclusão de registros por expiração.
- Tolerância comercial de 3 dias somente para status de renovação `past_due`. Cancelamento não acrescenta tolerância.
- Retenção de 90 dias é **proposta de política**, não limpeza automática implementada. Definir LGPD, exportação integral e política contratual antes do lançamento público.

## Fonte de verdade e limites
A identidade é Firebase Auth Google; cadastro privado em `users/{uid}`. A concessão comercial durável é D1: `access_accounts` (trial imutável), `access_grants` e `access_subscriptions`.
O documento privado `users/{uid}/access/current` contém uma **projeção protegida** da concessão. Firestore Security Rules negam todos os documentos de negócio se estiver suspensa ou após `request.time >= accessUntil`, exceto acesso ilimitado. Apenas o Worker com service account publica esse documento. A UI não determina autorização.

O endpoint `POST /access/ensure` exige Firebase ID token com `aud`/issuer válidos e Origin de DEV, consulta no Firestore o perfil já cadastrado e verifica o job de exclusão. Cria trial por `INSERT OR IGNORE` e sincroniza a projeção de maneira idempotente. NÃO recebe UID, planos ou prazos do navegador.
O backend Drive exige a mesma autorização comercial em rotas autenticadas e na continuação de OAuth. Tickets de miniatura são limitados por criptografia/expiração, e também exigem autenticação.
`GET /account/deletion/status` e exclusão seguem acessíveis a usuários expirados.

## Implantação coordenada — requisito
**Esta mudança NÃO pode ser implantada parcialmente.**
A PR modifica API/Worker, D1, frontend e regras do Firestore; os pipelines normais de DEV só publicam após merge em `master`. O fluxo na nova UI exige `/access/ensure`; as regras exigem `access/current`; publicar somente um deles quebra o login ou as consultas.

Ordem operacional mínima depois de testes verdes e autorização:
1. Aplicar `0007_access.sql` no D1 DEV; conferir tabela e FK. Não tocar PROD.
2. Publicar Worker DEV; confirmar `/health` e resposta não autenticada em `/access/ensure` (401).
3. Publicar frontend DEV e confirmar primeiro provisionamento de uma conta descartável e de uma conta **existente**; confirmar D1 e Firestore sem resetar trial.
4. **Só depois** publicar `firestore.rules`. Revisar que novas subcoleções negam leitura/gravação em contas com trial expirado/suspensas, com perfil e exclusão ainda disponíveis.
5. Repetir login, navegar, atualizar URL, testar Drive e exclusão; observar métricas/erros, sem concluir rollout antes dos checks.

Para minimizar indisponibilidade, publicar durante janela controlada e monitorar logs. A publicação de código **não cria** novos registros automaticamente em todas as contas: a primeira sessão após rollout provisiona uma vez, mantendo clientes/projetos e começando o relógio no primeiro provisionamento.

### Segurança e falhas
- A regra deny-by-default bloqueia acesso quando a projeção não existe. Se o Worker ou sua conta de serviço não estiverem configurados, a UI mostra um erro com opção de tentar novamente. **Não substituir isso por bypass na UI**.
- Account deletion remove `access/current` com os filhos e deleta `access_accounts` em D1 antes da identidade.
- Um pagamento futuro somente deve ativar acesso depois da confirmação assíncrona autenticada do provedor, webhooks idempotentes e reconciliação. **Não existe webhook ou cobrança nesta PR**.
- O futuro app ADM terá autenticação administrativa independente e backend de operações privilegiadas com auditoria; nada disso é exposto nesta SPA/Worker de usuário.
- Garantir que o serviço Cloudflare DEV possui credenciais administrativas restritas, armazenadas em Secrets (`FIREBASE_ADMIN_CREDENTIALS_JSON`) e que `ACCOUNT_DELETION_ENABLED` está ativo enquanto o endpoint `/access/ensure` reutilizar esse validador. Nunca mover chaves para `VITE_*`.
- Na alteração de cortesia/assinatura futura, a gravação D1 e sua projeção Firestore **não formam transação distribuída**. A futura operação administrativa deve publicar e reconciliar o estado antes de considerar a revogação concluída.
- Os testes E2E usam Firebase Emulator e interceptação de `/access/ensure` exclusiva dos testes, nunca dados DEV reais.

## Testes mínimos
Executar `npm test && npm run typecheck` em `api/`, `pnpm test && pnpm typecheck` na raiz, `pnpm test:rules`, `pnpm test:firebase` e inspecionar GitHub Actions da PR.
Cobrir trial 7 dias/limite exato, nenhuma renovação com login repetido, concessão finita/ilimitada, suspensão, três dias apenas para past_due, isolamento por UID, acesso do perfil expirado, revogação no Firestore, Drive e OAuth, exclusão de conta.
