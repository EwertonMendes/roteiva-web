# Feedback integrado Roteiva — envio gratuito via Resend

## Arquitetura

- **DEV e PROD** usam a API HTTPS do Resend Free, diretamente dos Workers Cloudflare, SEM Cloudflare Email Sending/Workers Paid, SMTP ou storage de imagens.
- Destinatário fixo no backend: `suporte.roteiva@gmail.com`. A mesma caixa recebe feedbacks com prefixos claros `[Roteiva DEV]` e `[Roteiva PROD]`.
- Remetente inicial de ambos: `Roteiva DEV/PROD <onboarding@resend.dev>`. O remetente de testes SOMENTE pode enviar para o e-mail cadastrado como proprietário da conta Resend. Portanto, **a conta Resend precisa pertencer a `suporte.roteiva@gmail.com`**. Não tentar enviar para outros destinatários com esse remetente.
- Para usar **`suporte@roteiva.com`** gratuitamente no futuro, verificar o domínio `roteiva.com` no Resend Free (DKIM/SPF/return-path conforme registros exibidos no painel), sem quebrar DNS atual. Somente após a verificação, definir a variável do Worker PROD `RESEND_FROM_EMAIL=suporte@roteiva.com` (allowlist fixa). Não ativar antes da verificação.
- O Email Routing Cloudflare (recebimento de mensagens enviadas para `suporte@roteiva.com`) pode continuar funcionando gratuitamente; não participa do envio do formulário.

## Configuração externa para habilitar envio (opcional para deploy)

1. Criar uma conta **Resend Free** em https://resend.com/signup usando **`suporte.roteiva@gmail.com`**; confirmar que o plano está em Free e sem upgrade automático.
2. Gerar **duas API Keys separadas**, cada uma com permissão **Sending access**: `Roteiva DEV` e `Roteiva PROD`. Nunca copiar as chaves ao chat ou ao código.
3. **DEV:** instalar a primeira como **Secret do Cloudflare Worker `roteiva-api-dev`**, nome exato `RESEND_API_KEY`. Pode usar Cloudflare Dashboard > Workers & Pages > `roteiva-api-dev` > Settings > Variables and Secrets, tipo Secret. Não usar a chave PROD.
4. **PROD:** GitHub > Settings > Environments > `cloudflare-production` > Environment secrets > New environment secret, nome `RESEND_API_KEY`, valor da chave PROD. A pipeline protegida valida e injeta essa chave no Worker na publicação atômica. A variável não é exposta ao frontend nem armazenada em código.
5. Caso a conta de destino no Resend não seja exatamente `suporte.roteiva@gmail.com`, os envios com `onboarding@resend.dev` serão rejeitados. A configuração de DOMÍNIO personalizado no Resend é opcional para o caso presente, mas obrigatória antes de usar `suporte@roteiva.com` como From.
6. Deploy DEV por pipeline normal. Deploy PROD somente pelo pipeline protegido. A chave Resend é opcional para a publicação: ausente/vazia, ela é omitida do upload aditivo de segredos; as sete credenciais de autenticação, provedores e cifra continuam obrigatórias. Sem chave no Worker, GET /feedback informa available:false e POST é recusado antes de persistir/enviar. A interface mostra que o envio ainda não está configurado. Se uma chave não vazia for fornecida, o formato continua sendo validado. Chaves já existentes não são removidas por este fluxo. **Não usar Cloudflare Email Sending**, nem comprar Workers Paid.
7. Smoke test real com usuário autenticado nos dois ambientes: texto simples, cinco imagens, recebimento na caixa Gmail, cabeçalho Reply-To, registro no D1 e comportamento após erro definitivo. Monitorar a quota gratuita Resend.

## Segurança e limites

- O Worker valida Firebase JWT verificado, origem, tamanho do corpo (6 MiB), até cinco anexos (1 MiB cada), magic bytes de imagens e conta em exclusão.
- D1 guarda somente texto, metadados e estado. Capturas vão diretamente à Resend via HTTPS e à caixa Gmail, sem R2, Firebase Storage ou outros buckets.
- Limite atômico por usuário: três envios aceitos/em processamento por 24 horas; no máximo dez tentativas registradas em 24 horas, e três tentativas por protocolo. O provedor também impõe **100 e-mails/dia e 3.000/mês no plano Free** compartilhados pela conta.
- Cada mensagem usa um `Idempotency-Key` derivado do protocolo único. Rejeições definitivas habilitam tentativas controladas; resultado ambíguo nunca é repetido automaticamente.
- E-mail de usuário no Reply-To vem do token verificado, não do cliente. Destinatário e API URL são constantes do backend. Não registrar mensagens, imagens ou segredo nos logs.
- Exclusão de conta remove metadados D1. A caixa de entrada Gmail requer política de retenção/remoção separada para os dados dos feedbacks.

Documentação oficial:
- https://resend.com/pricing
- https://resend.com/docs/send-with-workers
- https://resend.com/docs/send-with-nodejs
- https://resend.com/docs/knowledge-base/how-to-verify-a-domain
