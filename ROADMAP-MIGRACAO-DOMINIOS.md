# Migração do domínio do Roteiva

## Estado observado em 20/11/2026

A aplicação responde em `https://roteiva.com` com HTTPS válido. O Firebase Hosting `roteiva-web-prod` também atende `roteiva-web-prod.web.app` e `roteiva-web-prod.firebaseapp.com`. O domínio `www.roteiva.com` está conectado ao mesmo site como redirecionamento 301 para o domínio raiz e preservou o caminho e a query da sonda pública. O projeto `roteiva-web-prod` está no plano Spark e exibe a opção de adicionar outro site. A zona Cloudflare está no plano Free. [Planos Firebase](https://firebase.google.com/pricing) · [Hosting multisite](https://firebase.google.com/docs/hosting/multisites)

| Recurso | Referência anterior à migração |
| --- | --- |
| App em produção | Manifesto público SHA `6571badf72256b8b79da4bcb7a0762330ce1eb8d`, versão Hosting `189105`, 18/11 às 18h44 (Brasília) |
| Pipeline PROD | [Execução 44401028956](https://github.com/EwertonMendes/roteiva-web/actions/runs/44401028956), concluída com sucesso |
| Worker | `roteiva-api-prod`, versão `28d178ea-8949-4f9c-9194-16a2f1fb5f80` a 100%, `FRONTEND_ORIGIN=https://roteiva.com` no SHA publicado |
| API e banco | `https://api.roteiva.com` como custom domain do Worker, D1 `roteiva-drive-prod`. `/health` devolveu PROD e o preflight aceitou a raiz e recusou `app` antes do corte |
| DNS anterior | Nameservers `nadia.ns.cloudflare.com` e `yoxall.ns.cloudflare.com`. Raiz A `199.36.158.100`, www CNAME `roteiva-web-prod.web.app`, ambos DNS Only. API gerenciada pelo serviço Workers com proxy. `app` sem registro. Preservar MX, SPF, DKIM, DMARC, TXT de propriedade e registros de validação |
| Firebase Auth | Projeto `roteiva-web-prod`, `authDomain=roteiva.com`, domínios autorizados `roteiva.com`, `www.roteiva.com`, `roteiva-web-prod.firebaseapp.com` e `roteiva-web-prod.web.app` |
| OAuth Firebase | O cliente Web automático no projeto `roteiva-web-prod` tinha três handlers, para `roteiva.com`, `roteiva-web-prod.firebaseapp.com` e `roteiva-web-prod.web.app`. As três entradas foram mantidas |
| OAuth de armazenamento | Callbacks `https://api.roteiva.com/oauth/drive/callback` e `https://api.roteiva.com/oauth/dropbox/callback` |

## Destinos

| Endereço | Destino após homologação |
| --- | --- |
| `https://app.roteiva.com` | SPA React e handler Firebase Auth no site `roteiva-web-prod` |
| `https://roteiva.com` | Site estático `roteiva-site-prod` no mesmo projeto. Raiz e rotas de aplicativo com 302 durante a transição |
| `https://www.roteiva.com` | Alias com redirecionamento para `roteiva.com` |
| `https://api.roteiva.com` | Worker e D1 atuais |
| `https://roteiva-web-dev.web.app` | Hosting, Firebase Auth, Firestore, Worker e D1 DEV atuais |

A edição do site institucional ocorrerá em um deploy independente. Reservar os arquivos legais, a verificação do Google e o namespace `/__/auth/`. Quando Astro estiver pronto, publicar sua saída estática nesse site, remover o 302 da raiz e conservar os redirects das rotas antigas e as URLs públicas.

## Inventário de contratos

- `shared/environments.ts`, a configuração Vite, `firebase.prod.json` e `VITE_FIREBASE_AUTH_DOMAIN` no ambiente GitHub `firebase-production` precisam concordar sobre o Auth PROD. O SDK mantém o projeto e a aplicação Firebase originais. O login Google usa popup e restaura a sessão no armazenamento da origem atual. A nova origem pode pedir login novamente com o mesmo Google e deve resolver o mesmo UID.
- O Worker valida a identidade D1 e os endpoints dos callbacks. O CORS e as operações POST usam origens exatas. O CSP de PDFs utiliza a origem permitida ou a canônica quando a navegação do iframe omite `Origin`. Os uploads Drive na estratégia legada e as prévias Stream opcionais também leem `FRONTEND_ORIGIN`.
- Drive e Dropbox mantêm credenciais, escopos, cookies host-only, PKCE e state no fluxo atual da API. O retorno confirmado usa a nova origem. Os popups usam `sessionStorage`, `postMessage` com origem e nonce e `BroadcastChannel` na própria origem. Trocar de origem durante uma autorização pode impedir a notificação à aba anterior. Finalizar popups antes da janela de corte e recarregar a Biblioteca no app para conferir o resultado.
- O Google Picker envia a origem atual ao Google. No projeto Drive PROD, adicionar a origem JavaScript ao cliente Web e o referrer `https://app.roteiva.com/*` à chave Picker, preservando as restrições de APIs e os valores anteriores para rollback. No projeto Firebase PROD, conferir a mesma origem e o novo handler no cliente Google vinculado ao login. As páginas de marca, suporte e privacidade continuam na raiz. Conferir as configurações Dropbox mantendo o callback atual.
- Convites de aprovação usam `/review#invite=…` ou `/review/<token>`. A transferência usa redirecionamento sem fragmento no cabeçalho `Location`, permitindo que o navegador herde o fragmento. Testar também caminho e query, com valores sintéticos. Convites ativos continuam no D1.
- Feedback e exclusão de conta usam a API autenticada. O domínio do remetente de feedback `suporte@roteiva.com` é independente da origem do app. Páginas públicas permanecem disponíveis nos caminhos atuais.
- O service worker intercepta caminhos de mídia específicos e não serve navegação offline da SPA. IndexedDB, Cache Storage, localStorage, sessionStorage e Auth ficam isolados por origem. Nenhuma transferência de armazenamento é necessária. O mesmo Firestore e as mesmas conexões D1 reaparecem após entrar na origem nova.
- Os retornos futuros do Asaas derivam da origem canônica. Webhook, checkout e concessão por pagamento seguem o estado registrado em [ROADMAP-PAGAMENTOS-ASAAS.md](ROADMAP-PAGAMENTOS-ASAAS.md).

## Sequência de publicação

1. Verificar a referência de rollback e o estado dos provedores. Associar somente `app.roteiva.com` ao site atual. Criar na Cloudflare os registros exatos fornecidos pelo assistente do Firebase em DNS Only. Conferir DNS público, HTTPS, manifesto e o handler. [Domínios personalizados](https://firebase.google.com/docs/hosting/custom-domain)
2. No Firebase Auth, adicionar `app.roteiva.com`. No cliente Google do Firebase PROD adicionar `https://app.roteiva.com/__/auth/handler` e conferir as origens do login. Preservar o handler legado. Preparar cliente Drive PROD e chave Picker conforme o inventário. [Auth com Google](https://firebase.google.com/docs/auth/web/google-signin)
3. Validar em DEV via PR e conferir a regressão isolada. Preparar o site institucional e verificar seu endereço Firebase antes de mover domínios.
4. Depois do merge e da aprovação do proprietário para o SHA completo da `master`, iniciar [Promote approved commit to PROD](https://github.com/EwertonMendes/roteiva-web/actions/workflows/production.yml) com `confirmation=DEPLOY ROTEIVA PROD` e `domain_cutover=true`. O modo lê a identidade e integridade D1, exige schema compatível, deixa as migrations Asaas em DEV e publica apenas o Hosting do app no Firebase. O Worker aceita primeiro a origem nova e mantém a raiz por até 24 horas a partir do seu deploy. Acompanhar e aprovar os jobs protegidos em `cloudflare-production` e `firebase-production` na mesma janela. Se a publicação do app falhar após a troca do Worker, restabelecer o par anterior antes de expirar a janela.
5. Homologar no app com uma conta Firebase PROD existente, autorizada para QA. Comparar UID, sessão após refresh/logout, leitura de projetos e clientes, agenda, finanças, integrações e biblioteca. Validar Drive/Dropbox com conexões já existentes e verificar Picker, PDFs e links de convite em desktop e mobile. Qualquer gravação de teste ou entrega real de feedback exige a conta de teste autorizada.
6. Publicar os arquivos públicos em [Publish institutional Hosting PROD](https://github.com/EwertonMendes/roteiva-web/actions/workflows/institutional-production.yml), com o SHA aprovado e `confirmation=DEPLOY ROTEIVA SITE`. Confirmar o smoke em `roteiva-site-prod.web.app` e o handler reservado antes de mover domínios. Só depois da homologação do app, transferir a raiz e www conforme a opção de transferência oferecida pelo assistente, mantendo o destino www → raiz. Conferir os dois vínculos, certificados TLS, páginas públicas e a navegação em Chrome. A transferência e o rollback podem depender de validação DNS/TLS.
7. Revalidar API, login, links antigos, páginas legais e app, registrar os resultados e fechar a janela de compatibilidade.

## Rollback

Se a etapa de preparação falhar, a raiz e www continuam atendidos no site original. Remover a entrada nova somente se for necessário interromper a preparação e se o domínio ainda não tiver recebido usuários. Se o frontend novo falhar, restaurar a versão Hosting `189105` e coordenar com a versão Worker `28d178ea-8949-4f9c-9194-16a2f1fb5f80`. Confirmar o manifesto, a configuração de Auth anterior e o preflight na raiz. Caso a raiz já tenha sido transferida, restaurar primeiro os vínculos raiz e www ao site original e reaplicar apenas os registros de propriedade e TLS solicitados pelo assistente. Checar HTTPS externamente e conferir paths, redirects e sessão em navegador. Manter Firestore e D1 no lugar durante toda a recuperação.

## Evidências e pendências

| Etapa | Estado em 20/11/2026 |
| --- | --- |
| Infraestrutura | `app.roteiva.com` associado a `roteiva-web-prod` e CNAME `app → roteiva-web-prod.web.app` publicado em DNS Only. CNAME confirmado no resolvedor público. Firebase já verificou o DNS e iniciou emissão do certificado |
| Hosting institucional | `roteiva-site-prod` criado no mesmo projeto Spark. Aguardando publicação protegida dos arquivos públicos |
| Firebase Auth | Autorização de `app.roteiva.com` confirmada no console. Cliente Google existente salvo com a nova origem e `https://app.roteiva.com/__/auth/handler` |
| Drive e Picker | Cliente Web do projeto Drive PROD com a origem nova, mantendo callbacks. Chave Picker com os referrers novos e as restrições Google Drive API e Google Picker API |
| Dropbox | Callback do código preservado. A sessão atual do console Dropbox não lista o app Roteiva. Confirmar branding e callback com a conta proprietária e validar a conexão com um usuário existente |
| Testes de preparação | Builds DEV/PROD verificados. Os testes unitários cobrem CORS, upload Drive na janela de transição, callback Asaas e guardas de produção. D1 local, dry-run Wrangler e 37 testes das regras Firestore passaram. Os 6 testes do Hosting em Chromium desktop/mobile usaram destino de loopback |
| Produção atual | A raiz e www continuam no Hosting original. O último SHA público de referência e `/health` PROD foram conferidos. A promoção da migração, testes com conta existente e transferência da raiz permanecem pendentes |

A `master` auditada em `8ee83f9` já incluía as migrations Asaas `0035`–`0037` e rotas de cobrança validadas em DEV. A publicação do domínio usa o modo de corte sem escrita de schema. As rotas de cobrança permanecem restritas a DEV e o guard impede que o deploy normal aplique essas migrations antes do release de cobrança.
