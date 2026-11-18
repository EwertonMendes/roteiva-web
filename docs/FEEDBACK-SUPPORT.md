# Feedback integrado — DEV Resend Free / PROD Cloudflare Free

## Arquitetura
- **DEV:** Cloudflare Worker DEV entrega diretamente ao `suporte.roteiva@gmail.com` via API Resend Free, utilizando o secret `RESEND_API_KEY` **somente no Worker DEV**. Não precisa configurar segredo Resend no GitHub.
- **PROD:** Cloudflare Worker PROD entrega ao mesmo Gmail **somente através do binding nativo `FEEDBACK_EMAIL`**, restrito via `destination_address`. Usa remetente fixo `suporte@roteiva.com`, com Reply-To do e-mail Firebase verificado. Não usa Resend nem Workers Paid. Não existe fallback entre provedores.
- A Cloudflare documenta que envios para um endereço já verificado como destino da conta **são gratuitos em Workers Free**, inclusive quando apenas Email Routing está ativo. Envio para destinos arbitrários não é permitido nesse fluxo.
- A conta Cloudflare PROD é proprietária da zona `roteiva.com`; o Gmail `suporte.roteiva@gmail.com` foi mostrado como **Verified** em Email Routing. **O uso do domínio pelo site não comprova seu onboarding no Email Service.**
- O `send_email` binding exige que o remetente pertença a um domínio configurado no **Email Service / Email Routing**, na mesma conta do Worker. Isso deve ser conferido separadamente (não em Email Sending, que apresenta upgrade para Workers Paid).
- O simples redirecionamento inbound `suporte@roteiva.com -> suporte.roteiva@gmail.com` não substitui o binding `send_email` usado pelo endpoint de feedback.

## Habilitação e verificação sem custos
1. **PROD:** Cloudflare Roteiva PROD > Email Service > **Email Routing** > Domains / Routing Rules: confira se `roteiva.com` está ativo em Email Routing. Não alterar ou substituir registros MX, SPF ou DKIM automaticamente, pois isso pode interromper e-mails preexistentes.
2. **PROD:** Email Routing > Destination Addresses: confirme `suporte.roteiva@gmail.com` com status `Verified`. Esse passo já foi mostrado concluído.
3. **PROD:** o deploy do Worker injeta `FEEDBACK_EMAIL` (destinatário único) via `api/wrangler.jsonc`, sem API Keys. O pipeline protegido continua exigindo aprovação manual para Cloudflare PROD e Firebase PROD; a presença de binding não exige compra de plano.
4. **DEV:** no Worker da conta Cloudflare DEV, confirme o secret `RESEND_API_KEY` que o proprietário já cadastrou. Em DEV, o remetente padrão é `onboarding@resend.dev`, que em sandbox só pode enviar à caixa e-mail proprietária da conta Resend. Não adicione esse segredo ao GitHub, ao frontend ou à conta PROD.
5. Teste com usuário autenticado em DEV e PROD: POST feedback simples e com anexos; resposta de sucesso do provedor, relatório no D1 e recebimento real no Gmail. Capturas não são salvas no D1/Firestore/R2. Uma resposta de sucesso da API não deve ser confundida com confirmação de entrega final na caixa Gmail.
6. Se PROD rejeitar por `E_SENDER_DOMAIN_NOT_AVAILABLE` ou `E_SENDER_DOMAIN_NOT_CONFIGURED`, confira o onboarding de **Email Routing** do domínio em PROD, não compre Workers Paid. Os logs exibem apenas `providerCode` e `reportId`, nunca o conteúdo ou anexos. Se o recurso gratuito permanecer indisponível apesar do onboarding correto, interrompa e investigue a restrição sem mudar automaticamente para serviço pago.

## Proteções
- Firebase JWT validado no Worker, controle de origem, bloqueio de conta em exclusão.
- Até 5 imagens PNG/JPEG/WebP; otimização client-side, até 1 MiB por imagem, corpo multipart limitado a 6 MiB e validação de assinatura.
- Destinatário e remetente PROD fixos no código; binding restringe o destino. DEV usa token secreto apenas no Worker.
- Restrições D1 em PROD: 20 mensagens aceitas/em processamento por usuário em janela móvel de 60 minutos e limite adicional de 40 tentativas registradas por hora; chave idempotente por tentativa e até 3 tentativas explicitamente seguras por protocolo. DEV não aplica quota por usuário, mas mantém autenticação, validação de anexos, rate limiting global e idempotência.
- Erros definitivos do provedor permitem nova tentativa controlada; erro ambíguo não é automaticamente reenviado para evitar duplicidades.
- O histórico D1 contém apenas texto/metadados. E-mails e anexos ficam na caixa Gmail, sob política de retenção própria.

Referências oficiais:
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/

## Mensagens e fluxo do formulário (18/11/2026)

- **Sem tracking para o usuário:** o modal faz apenas `POST /feedback` no clique de envio. `GET /feedback` não é mais uma rota suportada. Não há consulta na abertura nem após falhas e a seção “Meus feedbacks anteriores” foi retirada.
- **D1 continua necessário:** exclusivamente para limites, idempotência, texto/metadados e exclusão de conta. Não há armazenamento das imagens nem uma área de histórico visível.
- **Um único template HTML:** `api/src/feedback-email.ts` produz HTML responsivo com cores Roteiva e versão `text/plain` para acessibilidade/compatibilidade. Inclui categoria, assunto, e-mail validado, descrição rotulada, imagens e protocolo. **Não inclui tela no e-mail**. O conteúdo do usuário é escapado antes de entrar no HTML. Não usa fontes, imagens ou CSS externos.
- **Bug de DEV corrigido:** o Worker utilizava `fetch(..., {redirect:'error'})`; o modo `error` não é implementado pelo runtime Workers e causa `TypeError` antes da requisição ao Resend. Substituído por `redirect:'manual'` para impedir redirecionamentos automáticos sem quebrar o envio ou expor o Authorization a outro host.
- **Erro real em DEV:** resposta Resend 4xx identifica configuração inválida/chave rejeitada; 5xx ou falha de transporte continuam como resultado incerto (sem retries automáticos). Logs contêm somente código/nome seguro do provedor, HTTP status e protocolo, nunca credenciais, conteúdo ou anexos. O `onboarding@resend.dev` só entrega para a caixa que é proprietária da conta Resend.
- **PROD:** mantém Cloudflare `FEEDBACK_EMAIL` com destino verificado `suporte.roteiva@gmail.com` e remetente `suporte@roteiva.com` — já houve comprovação de recebimento real do e-mail com anexos. Nenhum segredo Resend em PROD.


## Política de limites (18/11/2026)

- **DEV:** sem quota por usuário no formulário para testes. Continua sujeito à autenticação Firebase, rate limiting geral por IP, integridade/idempotência, tamanho do payload e limites do Resend Free.
- **PROD:** até **20 envios aceitos ou em andamento por usuário em qualquer janela de 60 minutos**, mais limite defensivo de **40 tentativas registradas por usuário na mesma janela** para impedir abuso por falhas deliberadas; computados em D1 atomicamente sem SELECT prévio. Limite independe do IP e não muda a quota do provedor.
- O `GET /feedback` continua desativado. O frontend informa o limite ao receber `feedback_hourly_limit` (429).
- Texto de anexos no formulário: “Adicione até 5 imagens”; processamento e sanitização permanecem transparentes.
