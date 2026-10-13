---
title: "Como rodar ciclos no Track: um playbook para times pequenos"
description: "Como um time pequeno pode rodar ciclos de duas semanas no Track com issues, sub-issues, relações, estimativas, status próprios e quatro visões — e o que ainda pede um workaround."
date: "2026-07-26"
author: "Zerosoftware"
tags: ["track", "ciclos", "playbook"]
---

Ciclos são a ideia boa menos glamorosa da gestão de projetos. Você escolhe uma janela — normalmente duas semanas —, decide o que cabe nela, faz e olha o que ficou de fora. Sem planning poker, sem formulário do Jira com quarenta campos. Uma caixa de tempo e uma lista.

É assim que a gente rodaria ciclos no Track para um time de três a dez pessoas. É um playbook, não um tour de features, então inclui as partes em que o Track faz você trabalhar um pouco: ainda não existe botão de "novo ciclo", e a gente mostra o workaround exato.

## Passo 0: um projeto por time, não por feature

No Track, um projeto é dono das suas issues, status e ciclos. Cada issue recebe um identificador montado a partir do slug do projeto: um projeto com slug `app` gera `APP-1`, `APP-2` e assim por diante.

A tentação é criar um projeto por iniciativa. Resista. Os ciclos vivem dentro de um projeto, então se o trabalho do time está espalhado em cinco projetos, você fica com cinco sprints em paralelo e ninguém sabe qual importa. Um projeto por time, labels para as iniciativas. As labels são livres (até 10 por issue, cada uma com sua cor) e dá para filtrar por elas.

## Passo 1: monte seus status

Um projeto novo vem com cinco status: **Backlog, Todo, In progress, Done, Cancelled**. Por baixo, cada status pertence a uma dessas cinco categorias, e é isso que mantém tudo organizado quando você adiciona os seus.

A maioria dos times pequenos precisa de exatamente mais um: **Em revisão**. Hoje, status próprios são criados pelo endpoint do próprio app, não por uma tela de configurações. Logado, abra o console do navegador em qualquer página do Track e rode:

```js
await fetch('/api/track/projects/<project-id>/statuses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Em revisão', category: 'in_progress', color: '#666666' }),
}).then((r) => r.json());
```

O id do projeto é o UUID da URL (`/app/track/projects/<project-id>`). A `category` precisa ser `backlog`, `todo`, `in_progress`, `done` ou `cancelled`. Status novos vão para o fim da lista; para reordenar, envie a lista completa de ids para `PATCH /api/track/projects/<project-id>/statuses/reorder` como `{ "statusIds": [...] }`.

Sim, é meio tosco. Uma tela de configurações para status e ciclos é o próximo passo óbvio. Atenção: são rotas internas autenticadas pela sua sessão — o Track ainda não tem API pública.

## Passo 2: crie o ciclo

Mesma história: ciclos são criados com um POST e depois aparecem em toda a interface — o formulário de issue, o painel de propriedades, os filtros e a lista de ciclos no rodapé da página do projeto.

```js
await fetch('/api/track/projects/<project-id>/cycles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Ciclo 14', startAt: '2026-08-03', endAt: '2026-08-14' }),
}).then((r) => r.json());
```

Nosso conselho: crie os próximos dois ou três ciclos de uma vez, para o planejamento nunca travar esperando alguém abrir o console. Nomes sem graça ("Ciclo 14", "Ciclo 15"). Ainda não existe endpoint para editar um ciclo: se errou as datas, apague (`DELETE /api/track/cycles/<id>`) e crie de novo.

## Passo 3: planejamento — issues, sub-issues, estimativas

Aqui o Track volta a parecer normal. Tudo abaixo está na interface.

- **Issues**: título, descrição com formatação, status, prioridade (urgent, high, medium, low), responsável, labels, data de entrega, ciclo e estimativa.
- **Estimativas**: números inteiros, e só. O Track não impõe escala. Escolha uma e mantenha — a gente gosta de 1, 2, 3, 5, e tudo acima de 5 é quebrado.
- **Sub-issues**: a partir de qualquer issue você cria uma subtarefa. É uma issue completa, com status e responsável próprios, e a mãe mostra as filhas. Use quando um "5" vira três "2".
- **Relações**: `blocks`, `related` e `duplicates`. Adicione pelo detalhe da issue digitando o identificador da outra. A outra issue mostra o inverso ("blocked by", "duplicated by"), então as dependências aparecem dos dois lados.

Uma reunião de planejamento prática: filtre a lista pelo status **Backlog**, ordene por **prioridade** e coloque issues no ciclo pelo painel de propriedades até a soma das estimativas parecer com o que o time realmente entregou da última vez. Essa soma é com você — o Track não totaliza estimativas por ciclo nem mostra gráfico de velocity. Uma planilha ou um guardanapo resolvem.

## Passo 4: as quatro visões e quando usar cada uma

O Track tem quatro visões, e cada uma responde uma pergunta diferente.

- **Lista** — "o que tem neste ciclo?" Filtre por ciclo, ordene por prioridade ou identificador. É sua visão de planejamento e triagem.
- **Board** — "onde está cada coisa?" As colunas são seus status, em ordem. Para mover um card, troque o status pelo seletor do card (ainda não há drag-and-drop no board). É a visão da daily.
- **Calendário** — "o que vence quando?" As issues caem na data de entrega; as sem data vão para uma lista de Não agendadas. Bom para trabalho preso a datas reais: um lançamento, uma entrega para cliente.
- **Gantt** — "a ordem faz sentido?" As barras vão da data de início à de entrega, e dá para arrastar uma barra para movê-la ou puxar as bordas para mudar início ou fim. Aliás, é assim que se define a data de início. Junto com relações `blocks`, é o melhor lugar para achar uma dependência agendada depois daquilo que ela bloqueia.

## Passo 5: visões salvas para ninguém remontar filtros

Qualquer combinação de tipo de visão, filtros e ordenação pode ser salva com um nome, e você pode marcar uma como padrão no projeto. Visões salvas são pessoais — cada um tem as suas —, então sugira algumas para o time:

- **Este ciclo — board**: board filtrado pelo ciclo atual.
- **Minhas coisas**: lista filtrada por você como responsável, ordenada por prioridade.
- **Urgente, qualquer ciclo**: lista com prioridade urgent + high.
- **Trabalho com data**: calendário filtrado por uma label como `cliente`.

Quando começar um ciclo novo, atualize o filtro de ciclo na visão "Este ciclo" e salve de novo.

## Passo 6: durante o ciclo

O loop diário é curto:

1. Abra o board. O que estiver parado há tempo demais em **In progress** ganha um comentário.
2. Comentários aceitam @menções; a pessoa mencionada recebe uma notificação no **Inbox** do Track, que também reúne atribuições, mudanças de status e comentários nas suas issues.
3. Anexe prints ou logs na issue (até 10 MB por arquivo).
4. Cada issue guarda um log de atividade: quem mudou status, prioridade, responsável, ciclo ou título, e quando. Quando alguém pergunta "por que isso atrasou?", a resposta costuma estar lá.

## Passo 7: fechando o ciclo

No último dia, filtre a lista pelo ciclo e veja o que não está numa categoria de concluído. Para cada sobra, decida: passar para o próximo ciclo (uma mudança no painel de propriedades), devolver ao backlog ou cancelar. Cancelled é um status de verdade por um motivo — matar trabalho de propósito é uma feature.

Depois, uma retro de cinco minutos. Se você usa o Docs, o template **Retro semanal** que já vem incluído serve bem, e dá para linkar a página nas issues do próximo ciclo.

## O que falta (de verdade)

O Track cobre o núcleo de um fluxo com ciclos, mas não tudo. Hoje não há tela de configurações para status nem ciclos, não há gráficos de velocity nem burndown, não há passagem automática do que ficou inacabado, não há atalhos de teclado nem sincronização em tempo real — atualize a página para ver as mudanças de um colega. Se isso é central no jeito do seu time trabalhar, um tracker mais maduro como o Linear ainda vai servir melhor, e a gente prefere dizer isso agora.

Se o que você precisa é uma caixa de tempo, uma lista e um time que concorda sobre o que significa "pronto", você tem tudo acima. E roda no seu próprio servidor de graça, ou no Zerosoft Cloud com um plano gratuito.
