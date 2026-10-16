# Roteiva — versão de testes

A plataforma continua disponível localmente na porta 5173.

## O que está disponível

- Visão geral “Hoje no estúdio”: agenda, próximos prazos, ajustes e recebimentos vencidos.
- Clientes: contatos, edição, histórico, pacote mensal e checklist das entregas por mês.
- Projetos: briefing, cliente, prazo, etapa, tarefas, modelos de produção, materiais, agenda e resultado financeiro previsto.
- Financeiro: receitas e custos, filtros de mês/ano/cliente, edição e exclusão, centavos, gráfico proporcional, parcelamento e exportação CSV.
- Agenda: cadastro, edição, exclusão e vínculo com o projeto; início, término, duração e aviso de sobreposição; o formulário recebe o dia selecionado.
- Biblioteca: envio real de arquivos ao armazenamento do servidor, abertura e download; associação ao projeto, ordenação e indicação de versão para reenvios do mesmo nome.
- Aprovações: link por arquivo, player, comentários no tempo do vídeo, decisões, comparação de dois cortes, atualização manual da etapa do projeto e desativação de links.
- Persistência: banco local do servidor, cópia dos registros no navegador, recuperação de rascunhos e verificação de conflitos entre janelas.

## Como iniciar uma nova cópia

É necessário Node.js 22.13 ou superior. Instale as dependências com `npm run install:ci` e depois execute `npm run dev`. O comando prepara as tabelas locais antes de abrir o servidor.

Abra http://127.0.0.1:5173/ . No modo local, o login de demonstração é feito em `/signin-with-chatgpt?return_to=/`.

Os dados do banco e os arquivos enviados ficam em `.wrangler/state`. Preserve essa pasta para manter os cadastros e materiais entre reinicializações. O pacote de código não contém os dados privados do seu espaço de trabalho.

“Exportar cópia” baixa os cadastros e lançamentos em JSON; os vídeos e demais arquivos binários não estão incluídos nesse JSON. O CSV exporta os lançamentos exibidos pelos filtros.

## Observações de uso

- Um pacote recorrente registra o valor combinado e a quantidade mensal de entregas. Ele não cobra o cliente nem cria receitas automaticamente.
- Parcelar divide o valor total informado entre os meses, preservando os centavos. Para entrada e saldo com valores diferentes, registre dois lançamentos.
- O resultado do projeto considera receitas e custos previstos; não substitui contabilidade ou apuração de impostos.
- Arquivos de até 250 MB por envio: vídeo, áudio, imagem, PDF, TXT, DOCX ou ZIP. Arquivos antigos que eram apenas registros devem ser reenviados para permitir abertura e download.
- O player utiliza os formatos que o navegador consegue reproduzir. Para maior compatibilidade, prefira MP4 com H.264/AAC.
- Cada link de revisão dá acesso ao arquivo correspondente a quem possuir o endereço. Ele pode ser desativado na área de aprovações.
- O endereço 127.0.0.1 funciona neste computador. Para enviar links a clientes fora deste Mac, é necessário publicar a aplicação e configurar o ambiente de produção. Esta entrega continua local.
- A etapa do projeto pode ser atualizada com a decisão do cliente usando “Atualizar etapa do projeto”. Reconfira se o retorno corresponde ao corte desejado.

## Verificação

- `npm run test:calendar`: intervalos, duração, sobreposição e compatibilidade com registros antigos.
- `npm run test:finance`: centavos, parcelas, datas e recuperação de sincronização.
- `npm run build`: compilação completa.
- `tests/studio-api.test.mjs`: testes de servidor com uma identidade fictícia isolada, contra uma instância local compilada na porta 5174. Não executa contra ambientes remotos.

## Uso no celular

O mesmo endereço adapta a interface ao celular, com navegação inferior (Início, Projetos, Agenda, Financeiro e Mais), formulários em painel deslizante, controles maiores e cartões financeiros com data e situação. Clientes, biblioteca e aprovações ficam no menu Mais.

Os horários de início e término são do mesmo dia. Um aviso informa sobreposições sem impedir trabalhos simultâneos; registros antigos sem término continuam preservados.
