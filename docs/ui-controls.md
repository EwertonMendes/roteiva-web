# Roteiva — contratos de componentes de interação

A implementação fica em `src/features/ui`. Todas as telas devem importar
`AppInput`, `AppTextarea` e `AppButton`, jamais adicionar variantes visuais
locais de elementos nativos. O DOM final permanece nativo e acessível.

- `AppInput`: texto, número, data, horário, busca, checkbox, radio e arquivo; aceita
  atributos HTML completos, `ref`, `name`, eventos, `required`, `invalid`,
  `leading` e `trailing`. Checkboxes, radios, arquivos e campos ocultos não
  recebem as dimensões de caixas de texto.
- `AppTextarea`: mesma base de tokens, estados nativos e FormData.
- `AppButton`: botões sem mudar o tipo implícito em formulários legados.
  Novos usos podem selecionar `variant`, `controlSize` e `loading`.
- `AppField`: label, hint e erro via render prop, com IDs estáveis.
- `MoneyInput` e `BrazilPhoneInput`: continuam responsáveis apenas por
  máscaras e transformação; delegam apresentação e refs a `AppInput`.
- `AppSelect`: opção única com teclado, portal fora de scroll containers,
  serialização por campo hidden e validação de obrigatório; manter o padrão
  `onValueChange` para não simular eventos nativos.
- `AppDialog`: para novos formulários modais simples, preservando a semântica
  nativa de `dialog`; modais de mídia com player e camadas complexas exigem
  migração separada com testes de gestos, scroll e foco.
- `useDismissibleLayer`: fechamento por clique fora e Escape para menus
  customizados, sem múltiplos listeners independentes.

## Tokens e identidade

`form-controls.css` define `--rt-brand-lime: #cfff47`, fidelidade à cor da
marca em tema escuro e borda verde de maior contraste com halo da marca em
tema claro. CSS de telas pode definir dimensões ou layout mas não cores de
foco próprias. Não reaproveitar `--lime` dos botões para foco: o tema visual
sobrescreve seu valor.

## Gates de manutenção

`pnpm test` verifica que novos arquivos TSX não declaram diretamente
`input`, `textarea` ou `button` (exceção: o hidden do AppSelect e as
primitivas). `pnpm typecheck`, build e Playwright validam integração
e aparência em desktop/mobile. Executar o fluxo real de DEV manualmente,
nunca adicionar automações de browser real à publicação.
