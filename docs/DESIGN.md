# Identidade visual e experiência — Roteiva

## Revisão editorial de produto — 13/11/2026 (PR #125, em homologação)
Referência visual vinculante: `Roteiva-revisao-editorial-16x9.pdf`, páginas 2–9, especialmente os mockups 4 e 9. A revisão preserva as telas já aprovadas de Clientes, Aprovações, Biblioteca e Configurações.

- **Identidade:** a marca oficial fornecida pelo responsável é preta ou branca, sem o detalhe verde. Os ativos `public/brand/roteiva-wordmark-{black,white}.svg` e `roteiva-symbol-{black,white}.svg` utilizam as imagens originais da [pasta de logos](https://drive.google.com/drive/folders/1X-dKFgg3tqyCSvnEpc3UNWk-WBxC8Smf?usp=sharing), recortadas por viewBox, sem filtro de cor. `BrandLogo` seleciona por tema. Cores funcionais (situação de projeto, saldos, gráficos, validações e foco) permanecem.
- **Dashboard:** título, métricas e fluxo próximos; altura decorrente do conteúdo, largura limitada e histórico de atividade ao lado de próximo compromisso no desktop; empilhamento sem overflow no mobile. Em monitores baixos, a página pode rolar naturalmente em vez de cortar a informação.
- **Capas:** projeto sem capa oferece a ação Adicionar capa mesmo antes de conectar Drive/Dropbox. Se não houver conta conectada, o editor orienta a conexão, sem solicitar escopos adicionais. Salvamento e recorte seguem o contrato `ProjectCover` existente.
- **Financeiro:** o olho de Já recebido alterna entre mostrar e ocultar os valores visíveis daquele cartão. É exclusivamente estado de apresentação; não altera o cálculo, exportação ou persistência.
- **Calendário:** clicar em dia vazio abre Novo compromisso com data selecionada; clicar em dia ocupado mostra a agenda e oferece Adicionar outro compromisso. Preservar o comportamento de edição e de sobreposição temporal.
- **Login:** a ilustração abstrata foi trocada por lente/diafragma vetorial de linhas neutras; nenhuma alteração em OAuth, cadastro e links legais.
- **QA:** diferenças visuais devem ser verificadas com capturas reais em desktop/mobile e dark/light. Implementado no PR não equivale a aprovado para PROD.

## Biblioteca virtual — explorador compacto (12/11/2026)

**IMPLEMENTADO EM BRANCH PR #123; ainda não VALIDADO com provedores reais:** a Biblioteca deixa de exibir os dois grandes cartões permanentes Drive/Dropbox e organiza o trabalho em um explorador com contexto visual consistente com Projetos e Clientes. Cabeçalho tem seletor de projeto com pesquisa e recentes, botões Contas, Atualizar e um único **Adicionar** com criar pasta, uploads, adicionar arquivos existentes e importar organização. A linha superior tem breadcrumbs, Lixeira, Pastas e controle lista/grade. Busca é por nome no projeto inteiro, com escopo alternativo da pasta atual. Menus ⋮ e clique direito permitem prévia/renomear/mover/remover e restauração na Lixeira, sem apagar originais. Contas de armazenamento ficam em um painel secundário, não na área principal.

Reutilizar `AppButton`, `AppInput`, `AppSelect`, `IconLabel`, `lucide-react`, logos dos provedores e tokens `--card`, `--subtle`, `--ink`, `--muted`, `--line`, `--accent`, `--on-accent`. CSS fica em `src/features/drive/library-explorer.css` e `library-project-picker.css`, com controle de responsividade e áreas de toque. Preservar nome acessível exato dos itens e usar menus nomeados em botões. Sem scroll horizontal, inclusive no mobile. O cache é metadado apenas; imagens/capas têm fluxo próprio.

A UX deve diferenciar **Selecionar do Google Drive** de importação com descendentes. Em `drive.file`, a seleção de pasta pelo Picker não autoriza todos os arquivos internos; não exibir promessa de importação completa. Na importação do Dropbox, uma pasta selecionada admite varredura paginada e limitada, sempre seguida de prévia antes de gravar. Reportar arquivos não autorizados e falhas por item. O usuário só deve validar depois de abrir em aparelho real, claro/escuro, com contas Google/Dropbox reais; E2E sintético não prova percepção visual ou permissões dos provedores.

## Aprovação e capas — 03/11/2026

Busca de capa usa AppInput com ícone, altura do controle compartilhado e foco apenas no campo, sem halo no rótulo. Capas de projeto oferecem conexões Drive/Dropbox ativas. PDFs de aprovação têm controles de páginas e zoom no painel e portal, sem toolbar nativa de download. Mensagens usam “dados”, “salvamento” e nomes de provedores quando necessário; “alteração preparada” nunca significa persistência confirmada.


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

- Abertura com marca permanece isolada em `src/site-experience.tsx` e `src/site-experience.css`.
- A abertura nunca deve prender a pessoa; há saída de segurança e suporte a `prefers-reduced-motion`.
- O Roteiva utiliza exclusivamente os ponteiros nativos do navegador/sistema operacional. Não esconder o cursor globalmente, instalar listeners de movimentação para efeitos decorativos nem renderizar overlays ou portais de cursor. Preservar as indicações nativas de interação (texto, pointer, grab/grabbing, disabled) e o funcionamento em modais e dispositivos touch.
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

## Configurações — layout do mockup (01/11/2026)

Configurações mantém o cabeçalho global de Projetos e apresenta cartões independentes para identidade do estúdio, perfil profissional, dados do estúdio, aparência, acesso e exclusão de conta, nessa ordem. No desktop os cards ocupam toda a largura disponível da área central da página (limitada apenas pelo layout global, sem um max-width exclusivo para Configurações), alinhados com o título; o formulário do estúdio distribui nome, tipo de atuação e salvar na mesma linha quando houver espaço. Em resoluções desktop intermediárias, a ação passa para a linha seguinte; no mobile, os campos são empilhados e a ação principal ocupa 100%. O perfil exibe foto/nome/e-mail autenticados pelo Google, mantendo e-mail somente leitura; o estúdio só pode ser salvo com dados válidos e alterados. Preferências usam botões com `aria-pressed`. O acesso exibe estado e validade realmente recebidos de `AccessGate`, sem criar uma assinatura fictícia. A exclusão mantém confirmação explícita, reautenticação Google e segurança do backend.

Usar Lucide já instalado, `AppInput`, `AppSelect`, `AppButton` e tokens atuais, com contrastes específicos para claro/escuro, foco global e reflow sem scroll horizontal no celular. O visual não autoriza alteração de dados, permissões ou regras. `tests/browser/settings-layout.spec.ts` cobre desktop/mobile e ações; a suíte manual `controls` inclui esse contrato.

## Gestão financeira — mockup 08 (02/11/2026)

A rota `/financeiro` utiliza `src/features/finance/FinancePanel.tsx` + `finance.css`, com layout encapsulado em `.app-view-finance` e herança dos controles compartilhados. Referência visual: título/subtítulo alinhados ao resto do workspace; ação “Nova receita” no cabeçalho; filtros Mês/Ano/Cliente/Situação/CSV em uma faixa; quatro indicadores; alerta de vencidos; gráfico anual em colunas selecionáveis; anel de recorrência; tabela com 6 colunas e ações de editar/excluir.

Dark: cartões grafite, bordas discretas, barra atual neutra/branca e resultado positivo verde, com alerta âmbar. Light: cartões claros, texto escuro, bordas sutis e contraste consistente. Evitar background global negro hardcoded. Fonte Ubuntu e tokens globais; títulos dos cards 20–26 px, métricas até 36 px, legendas 12–15 px e controles clicáveis com altura mínima 44 px quando possível. O chart mobile rola **dentro** do cartão, sem scroll horizontal da página; tabelas viram cartões com rótulos de campo, sem esconder valores/status/ações.

O botão **Exportar cópia** e todo o código de exportação JSON foram removidos por decisão do produto. **Exportar CSV** permanece na barra de filtros, limitado ao período/cliente/situação selecionados. Os valores do gráfico anual devem ficar imediatamente acima do topo das respectivas barras; quando a receita é zero, os valores aparecem perto da linha de base, e não no teto do gráfico. O donut usa cor sólida nos casos 0% e 100% para evitar linhas de junção. Não alterar totais/algoritmos do domínio, isolamento de dados ou regras do Firestore.

## Layout das telas internas

A barra global de estúdio, busca e ações e a faixa “Seu espaço / Dados na nuvem” foram removidas do layout compartilhado. As telas começam pelo conteúdo; a busca fica em Projetos e Clientes. No celular, um botão no conteúdo abre o menu lateral. Configurações permanece na navegação; tema e logout ficam no menu do perfil, e o histórico de atividades abre somente pelo dashboard. O aviso de demonstração e os alertas reais de sincronização permanecem.

## Cards de Projetos — 21/10/2026

Layout inspirado no mockup aprovado: painel arredondado com filtros, contagem de resultados, cards com título, cliente, situação, progresso e rodapé de prazo/tipo. Manter Clapperboard, Eye, Wrench e BadgeCheck com azul, amarelo, roxo e verde. Sem Google Drive/Dropbox conectado, mostrar a área vazia da capa com o botão Adicionar capa; o editor orienta a conexão sem conceder acesso a arquivos. Com capa disponível, mídia 2,5:1, ações legíveis sobre a imagem e edição direta por arraste, roda e pinça, com botões compactos de zoom/redefinição e teclado. Claro/escuro, filtros roláveis no celular e foco visível são obrigatórios.

No editor, remover sliders de posição e zoom. Preservar o foco visual ao ampliar, mostrar guias durante o arraste e manter o recorte idêntico ao card. O botão “Carregar mais imagens” deve ter ícone, ficar centralizado e separado da grade por pelo menos 20 px. Modais mantêm cursor nativo visível, incluindo grab/grabbing na área de recorte.

O modal de capa mantém altura padrão de 760 px, limitada à altura disponível da viewport (margens de 20 px no desktop e 8 px no celular). Cabeçalho e ações permanecem estáveis. A lista tem rolagem própria com espaço de scrollbar reservado. Loadings de lista/prévia usam indicador giratório e texto centralizados nos dois eixos da área disponível; respeitar movimento reduzido.

## Barra lateral e perfil

Uma única lista sob “Espaço de trabalho”: Visão geral, Projetos, Clientes, Aprovações, Financeiro, Calendário, Biblioteca e Configurações. Não mostrar o grupo Ferramentas, Atividades ou Aparência como itens de navegação. O botão de reticências junto ao perfil abre menu flutuante com alternância claro/escuro e saída da conta. Garantir foco visível, Tab, Escape e fechamento ao clicar fora. Preservar as cores originais das logos de cada tema; não aplicar filtros monocromáticos à marca.

O menu do perfil permanece aberto durante a alternância de tema. No modo escuro usa superfície elevada (#242426) e borda visível (#48484c). Entrada: painel sobe 10 px com fade; ações sobem em sequência a partir da opção inferior. Saída inverte o movimento e a sequência. Durações curtas (140–220 ms, com pequenos atrasos); respeitar prefers-reduced-motion, sem deslocamento.

Troca de tema não exibe toast nem indicador flutuante de salvamento: a própria alteração visual confirma a ação. O menu mantém foco e permanece interativo durante a persistência da preferência na conta.

## Comportamento de proteção dos materiais em aprovação (22/10/2026)

Ações de salvar/arrastar e menu contextual do navegador não devem ser oferecidas na área de prévia, tanto no modo link como no modo Google. O PDF é embutido em iframe sem `allow-downloads` e sem link para abrir o ticket em outra aba. Os botões de navegação, comentários, zoom, pinça, reprodução, temas e seleção de arquivos permanecem iguais. O link oficial para o Drive aparece somente quando o proprietário optou por compartilhar o arquivo diretamente (`drive_share_enabled`). Essas medidas apenas dificultam a cópia casual, não protegem os bytes exibidos contra ferramentas de desenvolvedor, captura de tela ou clientes HTTP; a proteção de masters exige prévias derivadas.

## Atalhos e menu de contexto na aprovação — 22/10/2026

Sem adicionar textos ou elementos na interface, `useReviewBrowserGuards` centraliza a supressão de `contextmenu` em captura no `document` inteiro (inclusive áreas vazias, cabeçalho, comentários e overlays da página), e intercepta atalhos comuns de inspeção, fonte, salvar e imprimir enquanto o portal está montado. O restante da área autenticada do profissional não recebe esses listeners. Os controles de player, zoom, campos de comentário, gestos touch, tema e navegação continuam funcionais. A página não pode interceptar menus do próprio navegador, DevTools externos, processos automatizados, contexto interno de PDF cross-origin nem gravação de tela; essas limitações não são falhas de permissão do Worker.

## Player de vídeo na página de aprovação (23/10/2026)

O vídeo utiliza exclusivamente controles nativos do `<video controls>`, inclusive tela cheia. O Roteiva não adiciona botões de "Ampliar vídeo" ou "Fechar tela cheia", estado auxiliar de expansão, comportamento de Escape ou overlay de fullscreen. Os recursos de marcação de tempo, comentários, reprodução responsiva e restrições de download continuam independentes. Não reutilizar os estilos `review-video-fullscreen` ou `is-video-expanded`.

### Ajuste posterior de login — 14/11/2026
A lente da proposta da página 9 tem seis lâminas em espiral formando o diafragma; não usar a estrela/polígono abstrato da primeira implementação. A arte desenha o barril, a abertura e as lâminas com caminhos vetoriais geométricos e tons neutros. O botão de login/cadastro com Google usa o G de quatro cores reais (#EA4335, #4285F4, #FBBC05 e #34A853), em vez da letra G tipográfica. Mantém o mesmo fluxo OAuth. **Homologação solicitada no DEV principal, não em preview separado.**
