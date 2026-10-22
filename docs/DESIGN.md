# Identidade visual e experiência — Roteiva

## Detalhes do projeto — outubro/2026

O conteúdo de `/projetos/:id` segue o mockup aprovado: formulário em largura completa, checklist compacto com progresso, resumo financeiro e lançamentos editáveis, materiais e agenda. Estilos em `features/projects/project-detail.css`, limitados a `.project-detail`; barra lateral preservada. Duas colunas passam a uma em telas estreitas; temas claro/escuro, foco e navegação por teclado mantidos. Tarefas concluídas têm marca e texto além da cor. Resultado negativo recebe cor própria.

Materiais mostram as pastas realmente vinculadas ao projeto no Drive. Adicionar/gerenciar abre a Biblioteca com o projeto selecionado, reutilizando vínculo e upload existentes, em vez do antigo input de upload que apenas exibia aviso. Não há novo armazenamento de URLs arbitrárias ou sistema de versões nesta alteração.

**Base visual preservada durante a migração para React/Vite em 16/10/2026.** Não redesenhar a UI ao introduzir Firebase/Auth/Drive sem uma demanda explícita.

## Select compartilhado (22/10/2026 · PR #85)

- O controle único `AppSelect` em `src/features/ui/` substitui os `select` nativos dos fluxos internos. Opções continuam declarativas via `<option>`, sem lógica de DOM duplicada nas páginas. Valor controlado: `value` + `onValueChange(string)`; formulários não controlados: `defaultValue` e `name` com campo oculto para `FormData`.
- O trigger e as opções usam tokens `--ink`, `--muted`, `--line`, `--paper` e `--subtle`, com os mesmos estados em claro/escuro. Menu em portal para não ser cortado por `overflow` de cartões/modais, com posição adaptada ao espaço disponível. Ícone ChevronDown/Check via Lucide.
- Acessibilidade: função combobox/listbox/option, label explícito, foco visível, Tab natural, Escape, setas, Home/End, Enter/Espaço e busca pelo início do nome. Itens desabilitados não são selecionáveis. Não adicionar estilos particulares de menus em páginas.
- Seletores de formulário preservam a semântica de `name`, os mesmos IDs/valores de negócio e isolamento por usuário; a UI não interfere em queries, APIs ou regras de segurança.
- Teste em Chromium desktop/mobile e temas claro/escuro; testes E2E escolhem opções visíveis via `chooseAppSelect`, nunca via `selectOption` nativo. Homologação visual em DEV permanece uma etapa distinta de compilação.

## Tipografia e cores

- Família **Ubuntu**, arquivos locais em `public/fonts/ubuntu/` e licença de redistribuição UFL.
- Pesos 300/400/500/700; títulos 700, subtítulos 500, texto conforme hierarquia.
- Paleta essencialmente monocromática (preto, branco, cinzas) em temas **claro e escuro**; imagens de usuários preservam suas cores.
- Bordas leves, cantos suaves, sombras difusas e transparências moderadas. Gráficos com rótulos legíveis.

## Efeitos e usabilidade

- Abertura com marca e cursor decorativo estão em `src/site-experience.tsx` e `src/site-experience.css`.
- A abertura nunca deve prender a pessoa; há saída de segurança e suporte a `prefers-reduced-motion`.
- Cursor personalizado somente em dispositivos com mouse e sobre elementos compatíveis; campos e vídeos preservam comportamento nativo; seletores de opção usam interação acessível consistente com a identidade do produto.
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
- Financeiro: filtros recebem ícones no label (sem poluir a lista de opções), indicadores numéricos recebem símbolo secundário, alerta de atraso e cabeçalhos de gráficos/tabela.
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

A barra global de estúdio, busca e ações e a faixa “Seu espaço / Dados na nuvem” foram removidas do layout compartilhado. As telas começam pelo conteúdo; a busca fica em Projetos e Clientes. No celular, um botão no conteúdo abre o menu lateral. Configurações permanece na navegação; tema e logout ficam no menu do perfil, e o histórico de atividades abre somente pelo dashboard. O aviso de demonstração e os alertas reais de sincronização permanecem.

## Cards de Projetos — 21/10/2026

Layout inspirado no mockup aprovado: painel arredondado com filtros, contagem de resultados, cards com título, cliente, situação, progresso e rodapé de prazo/tipo. Manter Clapperboard, Eye, Wrench e BadgeCheck com azul, amarelo, roxo e verde. Sem Drive conectado, não reservar área de fotografia nem mostrar edição de capa. Com capa disponível, mídia 2,5:1, ações legíveis sobre a imagem e edição direta por arraste, roda e pinça, com botões compactos de zoom/redefinição e teclado. Claro/escuro, filtros roláveis no celular e foco visível são obrigatórios.

No editor, remover sliders de posição e zoom. Preservar o foco visual ao ampliar, mostrar guias durante o arraste e manter o recorte idêntico ao card. O botão “Carregar mais imagens” deve ter ícone, ficar centralizado e separado da grade por pelo menos 20 px. Modais mantêm cursor nativo visível, incluindo grab/grabbing na área de recorte.

O modal de capa mantém altura padrão de 760 px, limitada à altura disponível da viewport (margens de 20 px no desktop e 8 px no celular). Cabeçalho e ações permanecem estáveis. A lista tem rolagem própria com espaço de scrollbar reservado. Loadings de lista/prévia usam indicador giratório e texto centralizados nos dois eixos da área disponível; respeitar movimento reduzido.

## Barra lateral e perfil

Uma única lista sob “Espaço de trabalho”: Visão geral, Projetos, Clientes, Aprovações, Financeiro, Calendário, Biblioteca e Configurações. Não mostrar o grupo Ferramentas, Atividades ou Aparência como itens de navegação. O botão de reticências junto ao perfil abre menu flutuante com alternância claro/escuro e saída da conta. Garantir foco visível, Tab, Escape e fechamento ao clicar fora. Preservar as cores originais das logos de cada tema; não aplicar filtros monocromáticos à marca.

O menu do perfil permanece aberto durante a alternância de tema. No modo escuro usa superfície elevada (#242426) e borda visível (#48484c). Entrada: painel sobe 10 px com fade; ações sobem em sequência a partir da opção inferior. Saída inverte o movimento e a sequência. Durações curtas (140–220 ms, com pequenos atrasos); respeitar prefers-reduced-motion, sem deslocamento.

Troca de tema não exibe toast nem indicador flutuante de salvamento: a própria alteração visual confirma a ação. O menu mantém foco e permanece interativo durante a persistência da preferência na conta.
