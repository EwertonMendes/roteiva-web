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

## DEV/PROD

O Worker DEV usa outra conta Cloudflare. Não pode enviar como suporte@roteiva.com se a zona roteiva.com só existe na conta PROD. O binding é por isso exclusivo da configuração PROD. Em DEV, GET do histórico funciona e o envio informa explicitamente "indisponível", sem sucesso simulado. Os testes unitários substituem o binding por um stub.

Para envio real em DEV, é necessária decisão separada: subdomínio delegado/remetente próprio, ou serviço/proxy de e-mail com chave restrita. Não reutilizar segredos PROD no DEV.

## Rollout, segurança e privacidade

- PR com testes frontend e Worker -> revisão -> deploy DEV sem envio externo.
- Verificar Email Service/Gmail na conta PROD -> promoção protegida -> teste real da caixa de entrada.
- Nenhum segredo adicionado ao código/GitHub. Nunca enviar arquivos, tokens ou conteúdo de feedback aos logs.
- Dados D1 são apagados pelo fluxo de exclusão da conta. O e-mail recebido no Gmail NÃO é apagado automaticamente; definir retenção e tratar pedidos de exclusão nessa caixa.
- Envio para destinatário verificado é gratuito no Free, sujeito a limites e políticas oficiais do serviço.

Documentação oficial:
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
- https://developers.cloudflare.com/email-service/platform/limits/
