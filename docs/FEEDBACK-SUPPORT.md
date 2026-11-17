# Suporte integrado — Cloudflare Email Service

## Contrato

- Remetente técnico fixo no backend: **suporte@roteiva.com**.
- Caixa de recebimento fixa no backend e no binding: **suporte.roteiva@gmail.com**.
- Endpoint do Worker: GET /feedback (últimos 15 registros do proprietário) e POST /feedback autenticado.
- Identidade e e-mail de resposta vêm do Firebase JWT verificado no Worker, nunca do formulário.
- Apenas texto e metadados no D1. Os anexos seguem diretamente para a caixa Gmail verificada; não há R2/Storage/Firestore para imagens.
- Browser reencoda imagens (até 1600px) para retirar EXIF, com limite de 5 imagens de 1 MiB cada.
- Servidor limita multipart em streaming a 6 MiB, checa formato pelo conteúdo e limita a 3 envios por usuário em 24 horas. Chave UUID por tentativa bloqueia duplicação concorrente/replay.
- E-mails têm Reply-To verificado e corpo plain text, sem permitir injeção de HTML ou cabeçalhos a partir do formulário.
- Falhas de entrega não retornam sucesso. Falhas posteriores ao envio são ambíguas e **nunca são repetidas automaticamente**.
- D1 armazena status sending/sent/failed, sem anexos. Gmail precisa de política de retenção separada.

## Configuração externa necessária ANTES de implantar

1. Criar **suporte.roteiva@gmail.com**. Confirmar acesso, 2FA e opções de recuperação.
2. Na conta Cloudflare que possui o domínio **roteiva.com**, acessar Compute > Email Service > Email Routing > Destination Addresses. Adicionar o Gmail e concluir a verificação enviada pela Cloudflare.
3. Conferir a ativação de **roteiva.com** no Email Service (Email Routing ou Email Sending) e a permissão para enviar como **suporte@roteiva.com**. Verificar DNS/SPF/DKIM sem sobrescrever MX/SPF existentes sem análise.
4. Recomendado para e-mail direto: em Email Routing > Routing Rules, criar a regra de recebimento **suporte@roteiva.com -> suporte.roteiva@gmail.com**. Essa regra é separada do envio de feedback feito pelo Worker.
5. O api/wrangler.jsonc da conta PROD fixa o binding FEEDBACK_EMAIL com destination_address=suporte.roteiva@gmail.com. **O GitHub não verifica nem cria a configuração real da conta Cloudflare**.
6. O Gmail precisa estar verificado **na mesma conta do Worker PROD** e roteiva.com deve pertencer a ela. Somente depois promover o código por pipeline protegida.
7. Validar em PROD com usuário de teste: envio sem imagens, envio com 5 imagens, anexos e cabeçalhos From/Reply-To no Gmail, não duplicação e histórico de cada proprietário.

## DEV/PROD: entregas isoladas no mesmo Gmail

- **PROD:** permanece no Cloudflare Email Service com o binding `FEEDBACK_EMAIL`, remetente fixo `suporte@roteiva.com` e destinatário `suporte.roteiva@gmail.com`. É necessário ativar o **Email Sending** para a zona `roteiva.com` na conta PROD; ter apenas o Gmail marcado `Verified` em Email Routing não comprova essa ativação. Erros de domínio/remetente são registrados com **código do provedor, sem conteúdo do feedback**, e mostrados como falha de configuração (não como suposta confirmação de envio). Verificar `Email Service > Email Sending` e `Activity Log` na conta Cloudflare PROD. Não alterar registros DNS existentes automaticamente.
- **DEV:** usa **Resend API** via HTTPS, sem Email Routing, e envia diretamente para **`suporte.roteiva@gmail.com`**. Não usa o domínio remetente PROD, token PROD nem conta Cloudflare PROD. Para testes, o remetente é `Roteiva DEV <onboarding@resend.dev>` (sandbox Resend), permitido **somente quando o e-mail da conta Resend for o destinatário**, neste caso `suporte.roteiva@gmail.com`. Resend tem quotas gratuitas; acompanhe o painel da conta.
- Para habilitar DEV, criar conta em https://resend.com com **`suporte.roteiva@gmail.com`**, criar API Key com somente permissão de envio e gravar como **secret do Worker DEV** `RESEND_API_KEY` na conta Cloudflare DEV (por painel ou `npx wrangler secret put RESEND_API_KEY --env dev` com credenciais DEV). Não adicionar a chave em `wrangler.jsonc`, `vars`, código, GitHub ou frontend. O próximo deploy do Worker preserva secrets já configurados.
- Enquanto esse secret não for configurado, DEV mostra **indisponível**, sem falsas confirmações nem chamadas externas. No PROD o fluxo não usa Resend.
- Se futuramente for necessário enviar DEV de outro remetente, configurar um domínio verificado na Resend e revisar explicitamente a política de origem, sem compartilhar a identidade de PROD.

## Tentativas, idempotência e diagnóstico

- O backend mantém o limite de **3 mensagens aceitas/em processamento por usuário em 24 horas**, e também **até 10 registros iniciados em 24 horas**, inclusive erros. Cada tentativa é reservada atomicamente no D1.
- Provedor que respondeu com erro **definitivo e não aceitou** o e-mail: status `failed`, `retry_safe=1`. O usuário pode tentar novamente, até 3 vezes no mesmo protocolo, preservando o controle de limite diário.
- Resultado **incerto** (timeout, falha de rede, resposta sem confirmação, falha após aceitação): fica em `sending`, não é reenviado automaticamente; o frontend cria uma nova chave apenas quando o usuário **clica novamente**, avisando sobre possível duplicação.
- Linhas antigas marcadas `failed` não ganham automaticamente permissão de retry; poderiam ter sido efetivamente entregues. A migração 0033 é aditiva.
- Resend DEV envia `Idempotency-Key` do protocolo na API para proteger duplicatas dentro da janela documentada de 24 horas.
- Para verificar falhas Cloudflare, filtrar logs estruturados pelo evento `feedback_email_send_rejected`, com `providerCode` e `reportId`; não registra e-mail, JWT, corpo nem anexos.

## Rollout, segurança e privacidade

- PR com testes frontend e Worker -> revisão -> deploy DEV; envio direto em DEV só depois de configurar o secret Resend.
- Verificar Email Service/Gmail na conta PROD -> promoção protegida -> teste real da caixa de entrada.
- Nenhum segredo adicionado ao código/GitHub. Nunca enviar arquivos, tokens ou conteúdo de feedback aos logs.
- Dados D1 são apagados pelo fluxo de exclusão da conta. O e-mail recebido no Gmail NÃO é apagado automaticamente; definir retenção e tratar pedidos de exclusão nessa caixa.
- Envio para destinatário verificado é gratuito no Free, sujeito a limites e políticas oficiais do serviço.

Documentação oficial:
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
- https://developers.cloudflare.com/email-service/platform/limits/
