# Identidade visual e experiência — Roteiva

**Base visual preservada durante a migração para React/Vite em 16/10/2026.** Não redesenhar a UI ao introduzir Firebase/Auth/Drive sem uma demanda explícita.

## Tipografia e cores

- Família **Ubuntu**, arquivos locais em `public/fonts/ubuntu/` e licença de redistribuição UFL.
- Pesos 300/400/500/700; títulos 700, subtítulos 500, texto conforme hierarquia.
- Paleta essencialmente monocromática (preto, branco, cinzas) em temas **claro e escuro**; imagens de usuários preservam suas cores.
- Bordas leves, cantos suaves, sombras difusas e transparências moderadas. Gráficos com rótulos legíveis.

## Efeitos e usabilidade

- Abertura com marca e cursor decorativo estão em `src/site-experience.tsx` e `src/site-experience.css`.
- A abertura nunca deve prender a pessoa; há saída de segurança e suporte a `prefers-reduced-motion`.
- Cursor personalizado somente em dispositivos com mouse e sobre elementos compatíveis; campos, selects e vídeos preservam comportamento nativo.
- Desktop e mobile têm navegação adaptada; manter contraste, foco visível, teclado, textos completos e modais com rolagem adequada.

## Código e arquivos de estilo

- `src/globals.css`, `src/responsive.css`, `src/refined-theme.css`: tokens, fontes e componentes globais.
- `src/dashboard-client.tsx`, `src/studio-features.tsx`: telas e fluxos locais.
- `src/demo.css`: aviso e comportamento da demonstração.
- `src/main.tsx`: ponto de entrada da SPA.
- `public/`: logos, favicon e fontes.

Toda alteração de UI deve preservar as funcionalidades já disponíveis e ser conferida em desktop e celular. Veja [roadmap](MVP-ROADMAP.md).
