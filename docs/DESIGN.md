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

## Linguagem voltada ao cliente

Textos de interface devem explicar o benefício, o estado confirmado e a próxima ação com linguagem comercial simples. Não expor ambientes DEV, nomes de infraestrutura, retries, limpeza de serviços, quotas ou diagnóstico técnico. Esses detalhes pertencem aos logs seguros e à documentação operacional. Mensagens de erro precisam ser úteis e honestas; não afirmar conclusão antes da confirmação do servidor. Configurações não exibem o painel interno de métricas de consultas. A identidade visual e os avisos necessários de privacidade/irreversibilidade permanecem preservados. O primeiro acesso convida a criar o espaço ou trocar de conta; exclusão permanente pertence às Configurações, após cadastro.

## Iconografia semântica (outubro/2026)

- Biblioteca única: `lucide-react` (SVG); sem novos pacotes e sem substituir os ícones animados de navegação.
- `src/features/ui/IconLabel.tsx` associa ícone decorativo a texto visível, preservando o nome acessível. SVG sem informação exclusiva utiliza `aria-hidden="true"`.
- `src/features/ui/project-status.ts` define uma só correspondência entre estado e ícone; **Todos = grade, Em produção = claquete, Em aprovação = olho, Ajustes = ferramenta, Aprovado = selo de aprovação**.
- Filtros de projetos declaram `aria-pressed` e mantêm texto visível; chips de status não acumulam ponto decorativo e ícone.
- Clientes: ícones discretos em indicadores superiores, cabeçalho da carteira e links de telefone/e-mail na ficha; as células continuam majoritariamente textuais.
- Financeiro: filtros recebem ícones no label (nunca dentro das opções nativas), indicadores numéricos recebem símbolo secundário, alerta de atraso e cabeçalhos de gráficos/tabela.
- Configurações: evitar redundância com ícones existentes; labels de identificação e armazenamento local usam símbolos específicos. Diagnóstico técnico não integra a interface do cliente.
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

## Layout das telas internas

A barra global de estúdio, busca e ações e a faixa “Seu espaço / Dados na nuvem” foram removidas do layout compartilhado. As telas começam pelo conteúdo; a busca fica em Projetos e Clientes. No celular, um botão no conteúdo abre o menu lateral. Atividades, tema e configurações continuam na lateral. O aviso de demonstração e os alertas reais de sincronização permanecem.

## Cards de Projetos — 21/10/2026

Layout inspirado no mockup aprovado: painel arredondado com filtros, contagem de resultados, cards com título, cliente, situação, progresso e rodapé de prazo/tipo. Manter Clapperboard, Eye, Wrench e BadgeCheck com azul, amarelo, roxo e verde. Sem Drive conectado, não reservar área de fotografia nem mostrar edição de capa. Com capa disponível, mídia 2,5:1, ações legíveis sobre a imagem e edição direta por arraste, roda e pinça, com botões compactos de zoom/redefinição e teclado. Claro/escuro, filtros roláveis no celular e foco visível são obrigatórios.

No editor, remover sliders de posição e zoom. Preservar o foco visual ao ampliar, mostrar guias durante o arraste e manter o recorte idêntico ao card. O botão “Carregar mais imagens” deve ter ícone, ficar centralizado e separado da grade por pelo menos 20 px. Modais mantêm cursor nativo visível, incluindo grab/grabbing na área de recorte.
