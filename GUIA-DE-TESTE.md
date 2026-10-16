# Roteiva — versão funcional para testes

Esta é uma versão local e funcional do sistema Roteiva, preparada para validar a experiência e o fluxo de trabalho antes da integração com a infraestrutura definitiva.

## Como iniciar

1. Instale o Node.js 22.13 ou mais recente.
2. Abra o Terminal dentro da pasta do projeto.
3. Instale as dependências:

   ```bash
   npm ci
   ```

4. Inicie o sistema:

   ```bash
   npm run dev
   ```

5. Acesse `http://127.0.0.1:5173/` no navegador.

## Fluxos disponíveis

- **Visão geral:** resumo de projetos, aprovações, agenda e faturamento.
- **Projetos:** criação de trabalho com cliente, prazo, status e valor.
- **Clientes:** cadastro e classificação entre recorrente e avulso.
- **Aprovações:** acompanhamento de versões, comentários e status.
- **Financeiro:** valores por trabalho e leitura mensal do faturamento.
- **Agenda:** calendário mensal, seleção de data e novos compromissos.
- **Biblioteca:** pesquisa, filtros, visual em grade ou lista e inclusão de arquivos.
- **Aparência:** alternância entre os modos claro e escuro.

## Dados de teste

Os novos compromissos e itens da biblioteca ficam salvos no próprio navegador. Fechar e abrir a página mantém os dados. Para reiniciar o protótipo, limpe os dados locais do site no navegador.

Nesta versão, a biblioteca registra localmente as informações do arquivo e permite pré-visualizar imagens durante a sessão. O envio definitivo do arquivo para armazenamento em nuvem será conectado na etapa de produção, junto com autenticação, contas de equipe e banco de dados remoto.

## Checklist sugerido

1. Alterne entre os modos claro e escuro.
2. Cadastre um cliente recorrente e outro avulso.
3. Crie um projeto com prazo e valor.
4. Confira a entrega criada na agenda.
5. Adicione reunião, produção e aprovação em datas diferentes.
6. Envie uma imagem para a biblioteca e teste busca, filtros e layouts.
7. Confira os números e o gráfico da área financeira.

