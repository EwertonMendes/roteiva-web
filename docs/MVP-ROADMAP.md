# Roadmap vivo — Roteiva MVP

**Atualização inicial: 16/10/2026.** Este é o documento **obrigatório** de acompanhamento por humanos e IAs. Arquitetura em [ARCHITECTURE.md](ARCHITECTURE.md). Entrega de cada PR deve revisar status, critérios, evidência e bloqueios (ver [AGENTS.md](../AGENTS.md)).

## Convenções de status

- **VALIDADO:** implementado, critérios de aceite verificados, com evidência de teste/PR.
- **IMPLEMENTADO:** existe no código, mas falta validação integral.
- **PARCIAL:** UI, lógica ou parte da integração existe; não utilizável de ponta a ponta.
- **PLANEJADO:** ainda não implementado.
- **BLOQUEADO:** há dependência ou problema técnico especificado.

**Regra:** uma página ou botão não significa funcionalidade operacional. Nunca marcar uma etapa concluída por uma proposta ou por uma build que apenas compila. Ao mudar status, acrescentar PR/commit, testes e observações de regressão.

## Fase preliminar — Higienização do repositório

**Objetivo:** remover arquivos demonstravelmente não utilizados **sem refatorar o funcionamento** nem apagar o backend legado.

- [x] Auditar árvore do repositório e imports das principais entradas da demo/app.
- [x] Retirar UI genérica gerada e sem referência, exemplos D1 do template, ícones padrão, logos experimentais e arquivos auxiliares associados.
- [x] Guardar o arquivo-fonte vetorial da marca fora de `public/`; manter fontes, logotipo em uso, favicon e licenças necessárias.
- [x] Adotar PNPM como instalador único e eliminar o `package-lock.json` conflitante; preservar `pnpm-lock.yaml`.
- [x] Preservar frontend **Next.js/Vinext** e componentes existentes; na PR #4, remover apenas APIs/banco/storage/autenticação legados e manter o runtime necessário ao frontend.
- [ ] Auditar e reduzir **dependências NPM não utilizadas**, atualizando `pnpm-lock.yaml` com ferramenta instalada e validando todos os builds, na fase de migração.
- [x] Remover `app/api/**`, Drizzle/D1, R2, auth de host e conectores de backend antigos, sem alterar componentes/estilos do frontend (PR #4).
- [x] Manter Next.js e Vinext, inclusive a compilação e o modo demo na rota principal (PR #4).
- [ ] Implementar autenticação e persistência novas apenas nas fases planejadas do MVP.

**Critério de aceite desta limpeza:** a PR contém exclusivamente remoção de arquivos sem uso confirmado e ajustes mínimos de configuração/documentação; testes de calendário/financeiro e build da demo passam no CI; caminho público e assets atuais permanecem. A compilação do backend legado não é coberta pelo CI Pages e deverá ser verificada antes da migração.

**Evidência:** [PR #3](https://github.com/EwertonMendes/roteiva-web/pull/3) (arquivos removidos, diff e validação automatizada).

## Panorama de hoje

| Componente | Situação | Evidência/limitação |
|---|---|---|
| Interface, páginas e estados locais | **PARCIAL** | `app/dashboard-client.tsx` e `app/studio-features.tsx`; fluxos prototipados |
| Demonstração GitHub Pages | **VALIDADO para build/deploy; navegação funcional a verificar em dispositivos reais** | Workflow `.github/workflows/deploy-pages.yml`, URL no README; somente `localStorage`, sem backend |
| Testes de calendário/financeiro | **IMPLEMENTADO** | `tests/studio-calendar.test.mjs`, `tests/studio-finance.test.mjs`; executados no CI do Pages |
| API antiga e D1/R2 | **REMOVIDO do código ativo** | PR #4; frontend Next/Vinext preservado; backend futuro será novo |
| Firebase Hosting/Auth/Firestore | **PLANEJADO** | Não configurados no repo |
| Worker API separado e D1 de tokens | **PLANEJADO** | Não existe Worker OAuth/refresh do MVP |
| Drive individual por usuário | **PLANEJADO** | Integração BRBET inspecionada externamente; não transferida |
| Revisão segura por cliente | **PLANEJADO** | Fluxo legado incompatível com arquitetura-alvo |
| Planos/entitlements | **PLANEJADO** | Não há verificação server-side de assinatura |

## Fase 0 — Prova técnica mais arriscada: Google Drive + Worker

**Prioridade P0.** Fazer **antes** de migrar a biblioteca completa, para validar que é possível usar Drive com segurança e arquivos grandes sem proxy.

- [ ] PoC Worker TypeScript publicado em ambiente DEV no plano gratuito.
- [ ] PoC de verificação segura de Firebase ID Token no Worker; rejeitar tokens inválidos, expirados e de outro projeto.
- [ ] OAuth 2.0 Google no Worker com `drive.file`, `state`, offline access e callback seguro; testar expiração, reconexão, revogação, troca de conta.
- [ ] D1 DEV com refresh token cifrado via WebCrypto/AES-GCM e chave em Workers Secrets; isolamento e não exposição.
- [ ] Criar pasta Drive gerenciada por usuário e listar arquivos que o app está autorizado a acessar.
- [ ] Testar upload de vídeo grande direto navegador→Drive com progresso, cancelamento/retry, sem atravessar Worker; comparar sessão resumable vs access token curto conforme [arquitetura](ARCHITECTURE.md).
- [ ] Testar dois usuários Google independentes: usuário A **não** lê ou opera Drive/token de B.
- [ ] Testar permissão de vídeo privado concedida e retirada para conta revisora.
- [ ] Decidir oficialmente organização de pastas/importação e fluxo de acesso do revisor; registrar resultados e limites.

**Aceite:** duas contas reais de teste independentes; upload de arquivo acima de 250 MB; reconexão e revogação reproduzíveis; falhas e CORS documentados; nenhum refresh token visível no browser/log; recursos dentro das franquias. Se falhar, marcar **BLOQUEADO** e replanejar o fluxo, não implementar gambiarra.

**Estado:** PLANEJADO. **Dependência:** projeto Google Cloud com consent screen em teste, Firebase DEV e conta Cloudflare DEV.

## Fase 1 — Fundação SaaS e ambientes

**Prioridade P0.** Dependente do aprendizado básico da Fase 0.

- [ ] Unificar a implementação da aplicação React/Vite/TS para produção, preservando visual e comportamento; manter Pages como demo isolada.
- [x] Padronizar lockfile/instalação com PNPM, removendo o npm lock e instaladores órfãos (higienização PR #3); **a auditoria de dependências em si continua pendente**.
- [ ] Criar projetos Firebase **DEV** e **PROD** separados: Hosting, Authentication e Firestore.
- [ ] Implementar login Google via Firebase Auth, logout, reidratação da sessão, proteção de rotas e erros.
- [ ] Criar cliente HTTP para Worker, com Firebase ID Token e tratamento de expiração/401; sem compartilhar UID arbitrário.
- [ ] Criar API Worker DEV/PROD separada, secrets/bindings por ambiente e CORS controlado.
- [ ] Configurar CI para typecheck, lint, testes, build e previews DEV; manter deploy PROD controlado.
- [ ] Configurar observabilidade de erros/cotas e documentação de configuração/deploy.
- [ ] Testar mobile, desktop, tema e navegação acessível.

**Aceite:** dois usuários entram em contas distintas, reiniciam sessão, veem telas protegidas; backend verifica identidade; artefatos de DEV/PROD isolados; CI verde. **Estado:** PLANEJADO.

## Fase 2 — Dados persistentes e isolamento

**Prioridade P0.** Dependente da Fase 1.

- [ ] Definir tipos de domínio, IDs estáveis, datas ISO, moeda em centavos e índices necessários.
- [ ] Estruturar `users` e `workspaces` com ownerUid imutável e regras deny-by-default.
- [ ] Extrair repositórios Firestore para clientes, projetos, tarefas, entregas, agenda e finanças; **não** salvar workspace como documento JSON único.
- [ ] Implementar cadastro/edição/exclusão por registro, paginação e estados vazios/erros.
- [ ] Definir estratégia de concorrência, descarte/recuperação offline e migração de dados prototipados; nunca sobrescrever silenciosamente.
- [ ] Criar testes Firebase Emulator de Security Rules, com ataque cruzado A/B e mutações de owner/plano/papel negadas.
- [ ] Implementar exportação e procedimento de exclusão de conta/dados pessoais (mídia continua no Drive, por padrão).
- [ ] Medir leituras/gravações para limitar custos.

**Aceite:** cadastros persistem entre dispositivos da mesma conta, alterações refletem corretamente, usuário B não lê/escreve dados de A, e Firestore não é vulnerável a edição de plano. **Estado:** PLANEJADO.

## Fase 3 — Gestão operacional de ponta a ponta

**Prioridade P0.** Depende da Fase 2.

- [ ] Clientes recorrentes/avulsos: contatos, pacotes, validações e histórico.
- [ ] Projetos: cliente, briefing, prazos, etapas, templates, tarefas e entregas.
- [ ] Agenda: eventos de gravação, reunião, entrega, aprovação, vínculo e aviso de conflito.
- [ ] Financeiro: receitas/despesas, centavos, parcelamento, filtros, status, resumos e CSV.
- [ ] Painel: indicadores com consultas eficientes e cálculo consistente; funcionamento mobile.
- [ ] Testes de cálculos, datas, permissões, edição concorrente e navegação.

**Aceite:** freelancer conclui ciclo cliente→projeto→tarefa→agenda→financeiro, fecha e reabre sessão sem perda de dados. **Estado:** PARCIAL na UI, PLANEJADO para produção.

## Fase 4 — Biblioteca Drive de verdade

**Prioridade P0/P1.** Dependente da PoC e das Fases 1–3.

- [ ] Integrar estado da conexão, reconexão, troca de conta e desconexão ao frontend.
- [ ] Pasta gerenciada `Roteiva` por proprietário + opção de importar arquivos específicos pelo Google Picker (sujeito à decisão da PoC).
- [ ] Listagem, metadados, filtros, vínculos por projeto, arquivos órfãos e erros de permissão.
- [ ] Upload resumable direto ao Drive, progresso/retry/cancelamento e validação de conclusão antes de gravar no Firestore.
- [ ] Versionamento sem perda de cortes anteriores; identificar arquivo por Drive file ID, não nome.
- [ ] Visualização/download autorizado e tratamento de arquivo apagado/movido externamente.
- [ ] Teste com arquivos reais grandes, rede instável e principais navegadores/dispositivos.
- [ ] Não armazenar arquivos do usuário em R2/Firebase Storage/D1/Firestore por padrão.

**Aceite:** duas contas enviam arquivos grandes e veem apenas seus ativos, versão antiga persiste, reconexão funciona, uso de banda do Worker não acompanha tamanho do arquivo. **Estado:** PLANEJADO.

## Fase 5 — Revisão segura e feedback de clientes

**Prioridade P1.** Dependente da Fase 4.

- [ ] Definir fluxo de convite autenticado com Google, por entrega e versão; validado com profissional real.
- [ ] Vincular concessão de acesso no Firestore à permissão real do Google Drive para a conta revisora.
- [ ] Exibir vídeo via visualizador/preview compatível; fallback para abrir no Drive se incorporação falhar.
- [ ] Implementar comentários por timestamp manual, status da revisão e histórico de decisões.
- [ ] Permitir solicitar alterações, aprovar e enviar nova versão mantendo rastreabilidade.
- [ ] Revogar convite e acesso ao arquivo (Firestore + Drive), tratando falhas parciais.
- [ ] Testar acesso indevido, expiração, reenvios, formatos não reproduzíveis e mobile.

**Aceite:** um profissional compartilha uma versão somente com cliente autorizado, cliente comenta e aprova, owner acompanha retorno e consegue revogar integralmente. **Estado:** PLANEJADO.

**Fora do aceite do MVP:** player proprietário com timeline controlada, comentário automático no ponto pausado, revisão anônima por link, transcodificação e streaming próprio.

## Fase 6 — Pronto para piloto comercial

**Prioridade P1.** Dependente de fluxos core concluídos.

- [ ] Controle de plano server-side e restrições reais; ativação manual por administrador inicialmente.
- [ ] Limites e proteção contra uso abusivo; monitoramento de cotas gratuitas.
- [ ] Política de privacidade, termos de uso, orientações de LGPD, exportação/exclusão e suporte mínimo.
- [ ] Revisar direitos de reutilização do antigo BRBET antes de copiar qualquer código/asset.
- [ ] Testes completos de onboarding/desconexão/usuário A vs B e restauração de erros.
- [ ] Revisar acessibilidade, performance, estados de erro, mobile, documentação e release checklist.
- [ ] Realizar piloto com **2–10 usuários reais**, coletar feedback e custo por usuário.
- [ ] Validar fluxo de venda e suporte antes de automatizar assinatura.

**Aceite:** usuário externo consegue entrar, conectar Drive, cadastrar cliente, produzir projeto, receber revisão e encerrar sem intervenção técnica; segurança validada e sem vazamento entre contas; custos monitorados. **Estado:** PLANEJADO.

## Depois do MVP (não bloquear lançamento)

- [ ] Equipes e papéis de estúdio; faturamento e convites avançados.
- [ ] Pagamento recorrente, gateway/webhooks e provisionamento automático de planos.
- [ ] Player controlado com timeline e comentários sincronizados, sujeito à viabilidade de mídia.
- [ ] Links públicos de revisão sem login, com autorização temporária e controles antiabuso.
- [ ] Notificações, relatórios avançados, PWA offline e outras integrações de storage.

## Registro contínuo de alterações — preencher a cada PR

| Data | PR / commit | Etapa | Status novo | Evidência e pendências |
|---|---|---|---|---|
| 16/10/2026 | [PR #1](https://github.com/EwertonMendes/roteiva-web/pull/1) | Demonstração Pages | Build/deploy validados; backend não implementado | CI build/testes calendário+finanças; demo localStorage |
| 16/10/2026 | [PR #2](https://github.com/EwertonMendes/roteiva-web/pull/2) | Organização documental | Estrutura/arquitetura propostas registradas | Somente Markdown; **não** altera funcionalidades |
| 16/10/2026 | [PR #3](https://github.com/EwertonMendes/roteiva-web/pull/3) | Higienização | Scaffold removido; PNPM padronizado | Pipeline Pages passou |
| 16/10/2026 | [PR #4](https://github.com/EwertonMendes/roteiva-web/pull/4) | Limpeza backend | APIs antigas, D1/R2/Drizzle e connectors retirados; **Next/Vinext e telas mantidos** | Validar build Vinext + Pages e testes; demonstração sem banco remoto |

### Protocolo para IAs

1. Ao começar, localizar a fase e suas dependências; reler decisões abertas em `ARCHITECTURE.md`.
2. Ao implementar, adicionar/ajustar checklist com escopo do PR, sem alterar status do que não testou.
3. Ao fechar PR, preencher linha com data, link, testes executados, resultado e bloqueios. **Atualizar no mesmo PR** (não em documentação futura).
4. Se mudar tecnologia/fluxo, sincronizar `ARCHITECTURE.md`, `DEVELOPMENT.md` e `README.md`.
5. Nunca transformar projeções de uso/custo ou ideias discutidas em garantias ou funcionalidades entregues.

**Próxima entrega recomendada:** Fase 0, PoC segura de Firebase ID Token + OAuth Drive + Worker + D1 + upload resumable.
