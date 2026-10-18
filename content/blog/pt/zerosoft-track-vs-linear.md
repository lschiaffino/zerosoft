---
title: "zerosoft Track vs Linear: uma comparação honesta"
description: "Onde o Linear está claramente à frente, onde o Track se garante e quem não deveria trocar. Uma comparação escrita por quem constrói o Track, com as lacunas à vista."
date: "2026-09-08"
author: "zerosoft"
tags: ["track", "linear", "comparação"]
---

Quando começamos o Track, escrevemos que [o Linear é provavelmente o melhor issue tracker já construído](/blog/linear-cuesta-8-track-costara-0). Continuamos achando isso. Aquele post era sobre preço. Este é sobre produto: o que cada ferramenta faz hoje, onde o Linear está à frente e quem deveria ficar onde está.

Um aviso antes de começar: aquele mesmo post prometia que o Track seria keyboard-first e teria API desde o primeiro dia. Hoje ele tem atalhos básicos de teclado, mas ainda não tem API pública. A gente prefere dizer isso logo a deixar você descobrir sozinho.

## A versão curta

- O **Linear** é o produto mais maduro, mais rápido e mais polido, com um ecossistema de integrações enorme. Se o seu time é pesado em engenharia e vive no GitHub, é muito difícil de bater.
- O **Track** cobre o núcleo de um issue tracker (projetos, issues, sub-issues, relações, ciclos, quatro visões) e é open source (AGPLv3), auto-hospedável e parte de uma suíte com CRM, chat, docs e agenda. Serve para times pequenos que querem ser donos dos seus dados e não precisam das integrações.

Agora, os detalhes.

## Onde o Linear está claramente à frente

**Velocidade e teclado.** A interface do Linear é construída em cima de atualizações otimistas e uma paleta de comandos; dá para fazer quase tudo sem tocar no mouse. O Track tem atalhos básicos: `C` cria uma issue, `J` e `K` percorrem a lista, `Enter` abre e `X` seleciona para editar várias em lote. Não tem paleta de comandos nem atalhos para mudar status, prioridade ou responsável.

**Tempo real.** No Linear, a mudança de um colega aparece na sua tela enquanto acontece. No Track você atualiza a página. Para um time de quatro, é um incômodo pequeno; para um de quarenta fazendo triagem no mesmo board, é uma diferença real.

**Integrações com Git.** O Linear liga issues a branches, commits e pull requests no GitHub e no GitLab, e pode mover issues sozinho quando um PR é mergeado. O Track se conecta ao GitHub por webhook: um PR ou commit que cita a issue (por exemplo `APP-12`) no branch, no título ou na mensagem fica vinculado, e dá para fazer a issue passar para em andamento quando o PR abre e para concluída quando é mergeado. Não há GitLab, e é um webhook que você mesmo configura, sem um app do GitHub para instalar.

**API e webhooks.** O Linear tem API pública e webhooks, e todo um ecossistema de ferramentas construídas em cima. O Track ainda não tem API pública nem webhooks; seus endpoints são internos e autenticados por sessão. (Outros produtos da zerosoft (Link, CRM, Cal) têm API pública; o Track não.)

**Planejamento acima da issue.** O Linear tem roadmaps e planejamento de alto nível entre projetos. O Track tem projetos e ciclos, e para por aí. Sem roadmaps.

**Ferramentas de ciclo.** Os ciclos do Linear vêm com acompanhamento de progresso e passagem automática do trabalho inacabado. No Track, ciclos e status próprios são gerenciados nos ajustes do projeto. Cada ciclo mostra quantas das suas issues estão concluídas, e ao concluí-lo as que ficaram inacabadas passam sozinhas para o ciclo seguinte. Não há gráficos de velocity nem burndown, e os ciclos não são criados sozinhos numa cadência: você cadastra cada um. Escrevemos um [playbook para rodar ciclos no Track](/blog/ciclos-en-track).

**Importação.** O Linear importa do Jira, do Asana, do GitHub Issues e de outros. O Track não importa do Linear, nem de lugar nenhum.

**Acabamento e amplitude.** Apps móveis, app desktop, integrações com Slack e muitas outras ferramentas, fluxos de triagem, anos de refinamento. O Linear teve muito tempo e um time muito bom. Dá para ver.

## Onde o Track se garante

**O modelo central está lá.** Issues com título, descrição, status, prioridade, responsável, labels, data de entrega, estimativa e ciclo. Sub-issues que são issues completas. Relações (`blocks`, `related`, `duplicates`) visíveis dos dois lados. Comentários com @menções, anexos de até 10 MB, log de atividade por issue e um inbox de notificações para menções, atribuições e mudanças de status. Status próprios mapeados em cinco categorias (backlog, todo, in progress, done, cancelled).

**Quatro visões de fábrica.** Lista, board, calendário (por data de entrega) e Gantt (arraste as barras para mudar início e entrega). Qualquer combinação de visão, filtros e ordenação pode ser salva como visão pessoal, e uma pode ser seu padrão.

**Você pode ser o dono.** O Track é AGPLv3. Dá para ler cada linha, hospedar no seu servidor de graça, e suas issues ficam num arquivo SQLite (ou num banco libSQL/Turso) que você controla. Ninguém pode mudar as regras nem descontinuar o seu plano. Escrevemos mais sobre [por que isso importa](/blog/el-lock-in-es-el-producto).

**Faz parte de uma suíte.** O mesmo login e o mesmo time te dão CRM, chat de suporte, docs, agenda e links. A retro do sprint pode morar no Docs; um bug que chegou pelo Chat vira issue no Track quando uma pessoa copia (o Chat não tem um botão para isso; se você quiser automático, um flow pode criar a issue quando chega uma mensagem). Se você é uma empresa pequena tentando reduzir o número de ferramentas e faturas, isso pesa.

**Preço que não cresce com o quadro de pessoal.** O Linear cobra por usuário nos planos pagos e tem um plano gratuito com limites; confira a página de preços deles para os números atuais. O Track auto-hospedado custa $0. O zerosoft Cloud tem um plano grátis para começar e depois cobra pelo uso do workspace, sem cobrança por assento.

## Quem deveria ficar no Linear

Seja honesto consigo mesmo. Fique no Linear se:

- Seu time de engenharia liga PRs a issues e depende dessa automação.
- Tem gente no time que vive no teclado e sentiria falta de uma paleta de comandos toda hora.
- Mais do que um punhado de pessoas trabalha no mesmo board ao mesmo tempo e precisa de tempo real.
- Você usa a API, os webhooks ou as integrações do Linear (Slack, Sentry, ferramentas de suporte etc.).
- Você planeja com roadmaps, ou depende de métricas de ciclo como velocity e burndown.
- Você precisa de apps móveis.

Para esses times, migrar para o Track hoje seria um retrocesso, e a gente não quer que façam isso.

## Para quem é o Track

O Track faz sentido se:

- Você é um time pequeno (agência, estúdio, startup em estágio inicial, time interno de operações) que precisa de issues, ciclos e um board, não de uma plataforma de engenharia.
- Você quer seus dados no seu próprio servidor, ou pelo menos numa ferramenta open source que poderia levar para lá.
- Você já usa, ou quer usar, outros produtos da zerosoft e prefere um stack só.
- O preço por assento é um custo real para você, principalmente com colaboradores eventuais que só precisam ver o board.

## Como testar sem risco

Suba o Track localmente com `DEMO_MODE=true` e explore os dados de demonstração, ou crie uma conta gratuita no zerosoft Cloud. Rode um ciclo de verdade com um projeto pequeno antes de mover algo importante. Não há importador do Linear, então migrar significa recriar suas issues abertas: tranquilo para um time com cinquenta tickets abertos, doloroso para um com cinco mil.

## Resumindo

O Linear é o melhor produto hoje, e para muitos times vale cada centavo. O Track é a alternativa honesta, aberta e auto-hospedável que cobre o núcleo, e que é sua. Vamos continuar diminuindo a distância. Quando tempo real ou uma API chegarem, vamos contar aqui, não antes.
