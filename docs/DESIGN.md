# Identidade visual e experiência — Roteiva

**Status:** padrões identificados no frontend atual. A migração para o MVP deve preservá-los e evoluí-los sem substituição visual indiscriminada. Atualizado em 16/10/2026.

## Tipografia e identidade

- Família principal **Ubuntu**, instalada localmente em `public/fonts/ubuntu/`, com licença UFL preservada. Pesos Light (300), Regular (400), Medium (500) e Bold (700), também em itálico.
- Hierarquia: títulos em 700; subtítulos e números de destaque em 500; textos e controles alternando 300/400/500 conforme relevância.
- Paleta **monocromática**, preto, branco e cinzas neutros, com temas claro e escuro; imagens de usuários preservam as cores originais.
- Gráficos em tons de cinza com rótulos; ações destrutivas/avisos podem usar indicação semântica discreta.
- `app/refined-theme.css` centraliza tokens e fontes; manter bordas de baixa opacidade, cantos suaves, sombras difusas e desfoque moderado.
- Logotipo monocromático aplicado por CSS sem alterar os arquivos originais.

## Interação e animações

- `app/site-experience.tsx` e `app/site-experience.css` implementam abertura com marca e cursor decorativo; abertura acompanha carregamento, possui saída de segurança e não interrompe navegação interna.
- Cursor de ponto + anel apenas para dispositivos com mouse; campos, seletores, vídeo e interações nativas preservam cursor nativo.
- Preferência `prefers-reduced-motion`: desativar cursor/efeitos decorativos e reduzir transições.
- Motion com finalidade de feedback, não como bloqueio de navegação nem de operações.

## Responsividade e acessibilidade

- Experiência completa em desktop e mobile; navegação inferior no celular (Início, Projetos, Agenda, Financeiro, Mais), com formulários e diálogos adaptados.
- Elementos clicáveis acessíveis por teclado, foco visível, labels de formulários, estados de loading/erro e contraste adequado em ambos os temas.
- Evitar texto cortado, controles fora da tela, scroll do fundo sob modal e dependência exclusiva de hover.
- Vídeos e uploads devem ter fallbacks, estados de progresso e erros claros; a experiência do Drive nunca deve expor tokens ou detalhes internos.
- Respeitar preferências de movimento e o desempenho em dispositivos modestos.

## Arquivos relevantes (estado atual)

- `app/globals.css`, `app/responsive.css`, `app/refined-theme.css`.
- `app/site-experience.tsx` e `app/site-experience.css`.
- `app/dashboard-client.tsx` e `app/studio-features.tsx`.
- `pages/demo.css` e `pages/main.tsx` para a demo isolada.

## Orientação para alterações

Manter tokens reutilizáveis e componentes coesos em vez de estilos pontuais espalhados; validar temas, desktop/mobile, foco/teclado, acessibilidade e estados reais. Se a arquitetura de estilos migrar, atualizar estes caminhos e o [roadmap](MVP-ROADMAP.md) no mesmo PR. Consulte também [AGENTS.md](../AGENTS.md).
