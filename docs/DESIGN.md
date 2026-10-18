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

## Iconografia semântica (outubro/2026)

- Biblioteca única: `lucide-react` (SVG); sem novos pacotes e sem substituir os ícones animados de navegação.
- `src/features/ui/IconLabel.tsx` associa ícone decorativo a texto visível, preservando o nome acessível. SVG sem informação exclusiva utiliza `aria-hidden="true"`.
- `src/features/ui/project-status.ts` define uma só correspondência entre estado e ícone; **Todos = grade, Em produção = claquete, Em aprovação = olho, Ajustes = ferramenta, Aprovado = selo de aprovação**.
- Filtros de projetos declaram `aria-pressed` e mantêm texto visível; chips de status não acumulam ponto decorativo e ícone.
- Clientes: ícones discretos em indicadores superiores, cabeçalho da carteira e links de telefone/e-mail na ficha; as células continuam majoritariamente textuais.
- Financeiro: filtros recebem ícones no label (nunca dentro das opções nativas), indicadores numéricos recebem símbolo secundário, alerta de atraso e cabeçalhos de gráficos/tabela.
- Configurações: evitar redundância com ícones existentes; apenas labels de identificação, cache local e diagnóstico usam símbolos específicos.
- Tamanhos usuais: filtros 16px, indicadores 18–19px, etiquetas 14–16px, cabeçalhos 16–20px; traço coerente, ritmo de 6–8px e cores herdadas do tema.
- CSS em `src/features/ui/semantic-icons.css`, carregado depois da camada tipográfica; respeitar layouts responsivos e `prefers-reduced-motion`.
- Somente ícones decorativos: jamais depender exclusivamente de cor ou desenho para comunicar estado/resultado. Texto, teclado, foco e contraste continuam mandatórios.

## Barra lateral simplificada (outubro/2026)

- A lateral exibe marca, navegação e perfil da pessoa usuária com ação de saída no rodapé.
- O cartão informativo redundante sobre o nome do estúdio, quantidade de arquivos e sincronização foi retirado da lateral. Informações equivalentes continuam nas telas e na barra superior quando relevantes.
- O perfil permanece ancorado ao rodapé tanto no desktop quanto no menu mobile aberto. Não reintroduzir o cartão sem uma necessidade funcional concreta.


## Biblioteca 2.0 — explorador minimalista (PR #29, em validação)

- Organização centrada nos arquivos, não no provedor: conta Drive e atualização ficam num menu discreto; projeto escolhido em um único controle no cabeçalho.
- Desktop: painel esquerdo para pastas vinculadas, direito para conteúdo com caminho de navegação, metadados essenciais e ações secundárias em menu. Uma pasta aberta substitui o conteúdo, sem empilhar painéis novos.
- Mobile: pastas e arquivos em níveis alternados, com voltar visível; nada de duas colunas comprimidas. O seletor vira tela inteira com lista rolável e confirmação fixa.
- Vinculação: checkbox separado da ação de abrir pasta, permitindo selecionar várias pastas inclusive após navegar; distinguir visualmente as já vinculadas.
- Filtros dos resultados carregados são indicados explicitamente como locais; não simular busca global. Priorizar uma interação para abrir pasta/arquivo.
- Usar tokens `--card`, `--line`, `--subtle`, `--ink`, `--muted`; não fixar cores dependentes de tema. Garantir labels, foco visível, Escape, scroll de fundo bloqueado e redução de movimento.
- Evitar representar pasta vinculada como arquivo importado no contador ou expor email/gestão da conta como conteúdo principal.
