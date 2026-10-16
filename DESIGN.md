# Identidade visual da interface Roteiva

A interface usa Ubuntu como família tipográfica principal, com arquivos locais em `public/fonts/ubuntu` e a licença original UFL. Os pesos disponíveis são Light (300), Regular (400), Medium (500) e Bold (700), com as respectivas versões itálicas. Títulos principais usam 700; subtítulos e números de destaque, 500; textos, controles e legendas alternam 300, 400 e 500 conforme sua importância.

A paleta da interface é monocromática: preto, branco e cinzas neutros, com tokens para os modos claro e escuro. Os gráficos também usam tons de cinza e rótulos. As imagens enviadas pelos usuários mantêm suas cores originais. Avisos e ações destrutivas podem manter indicações semânticas discretas.

`app/refined-theme.css`, importado depois dos estilos estruturais e responsivos, concentra as fontes e os tokens visuais. Os módulos translúcidos usam bordas de baixa opacidade, sombras difusas, cantos suaves e desfoque moderado. A navegação ativa e os botões devem seguir a mesma paleta.

A apresentação monocromática do logotipo é aplicada por CSS, preservando os arquivos originais da marca.

`app/site-experience.tsx` e `app/site-experience.css` controlam a abertura com a marca e o cursor. A abertura acompanha a preparação das fontes e do espaço de trabalho, tem saída automática de segurança e ocorre apenas ao carregar a página. A navegação interna permanece imediata.

O cursor usa ponto e anel com acompanhamento suave apenas em dispositivos com mouse. Botões ampliam o anel; campos de texto, seletores e vídeos preservam o cursor nativo. A preferência de movimento reduzido desativa o cursor decorativo e as transições da abertura. Os efeitos não alteram os dados do espaço de trabalho.
