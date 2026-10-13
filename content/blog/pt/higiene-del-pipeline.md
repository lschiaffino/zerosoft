---
title: "Higiene do pipeline para times pequenos: oito regras para o seu CRM não mentir"
description: "Um playbook prático para manter o pipeline de vendas limpo num time pequeno: como desenhar etapas, quando usar vários pipelines, o que fazer com negócios parados e como as tarefas mantêm tudo andando."
date: "2026-08-22"
author: "Zerosoftware"
tags: ["crm", "vendas", "playbook"]
---

Todo CRM começa limpo. Seis meses depois o quadro tem 140 negócios abertos, metade com data de fechamento do semestre passado, e a "previsão ponderada" é um número em que ninguém apostaria um almoço. Ninguém decidiu fazer bagunça. Ela foi se acumulando, uma atualização esquecida de cada vez.

Higiene de pipeline não é problema de ferramenta. É um punhado de regras que o time combina, mais um CRM que deixa visível quando alguém quebra essas regras. Estas são as oito que adotaríamos se fôssemos um time de vendas de cinco pessoas começando na segunda-feira, com o jeito como cada uma se traduz no que o Zerosoft CRM faz de verdade.

## 1. Um pipeline por processo de venda, não por pessoa

O Zerosoft suporta vários pipelines, cada um com as suas etapas, e trocar entre eles no quadro de negócios é um dropdown. A tentação é criar um por vendedor, por produto ou por região. Não faça isso.

Um pipeline deve representar um **processo de compra diferente**: negócio novo vs. renovações, ou upgrades self-service vs. negócios enterprise. Se dois pipelines teriam as mesmas etapas, eles são um pipeline só, filtrado por owner ou origem.

Um teste útil: se você não consegue explicar numa frase por que um negócio vai no pipeline A e não no B, sobra um pipeline.

## 2. Etapas são coisas que o comprador fez, não coisas que você espera

"Interessado" é um sentimento. "Demo realizada" é um fato. Dê às etapas o nome de algo verificável que aconteceu:

- Qualificado
- Demo realizada
- Proposta enviada
- Negociação
- Fechado ganho
- Fechado perdido

De cinco a sete etapas é suficiente para um time pequeno. Cada etapa no Zerosoft tem uma **probabilidade %**, e o quadro usa isso para mostrar no topo os negócios abertos, o valor aberto e uma previsão ponderada. Defina essas probabilidades a partir do seu próprio histórico, se tiver, e revise uma vez por trimestre. Uma etapa é marcada como **Fechado ganho** e outra como **Fechado perdido**; é isso que alimenta os relatórios de ganhos/perdidos e a taxa de vitória.

As etapas podem ser reordenadas arrastando nas configurações. Apagar uma etapa ou um pipeline que ainda tem negócios é bloqueado, e apagar é só para admins, para ninguém "arrumar" por acidente.

## 3. Todo negócio aberto tem uma próxima tarefa

Esta é a regra que faz a maior parte do trabalho. Se um negócio não tem um próximo passo com data, não é um negócio; é uma esperança com um valor.

O Zerosoft mostra a próxima tarefa aberta no topo da página de cada negócio, com um botão para concluí-la ali mesmo. A página de tarefas (`/app/crm/tasks`) agrupa tudo em Atrasadas, Hoje e Próximas, com filtro por owner. Transforme em hábito do time: ao concluir uma tarefa de um negócio, crie a próxima antes de fechar a aba.

Se preferir não depender de hábito, os [workflows](/blog/workflows-crm-tareas-de-seguimiento) podem criar o follow-up automaticamente quando um negócio chega a uma etapa.

## 4. Todo negócio aberto tem valor e data de fechamento

Uma previsão é tão boa quanto os negócios que a alimentam. Um negócio sem valor é invisível na previsão ponderada; um negócio sem data de fechamento é invisível no tempo.

Ressalva honesta: o Zerosoft ainda não tem campos obrigatórios. Não dá para forçar um valor na criação. Então transforme isso em regra e deixe as violações fáceis de achar:

- Na visão de **tabela** de negócios, ordene por data de fechamento. Os negócios sem data vão para o fim, onde você vê todos juntos.
- Ordene por valor crescente para ver os zeros primeiro.
- Filtros e ordenação ficam na URL da página, então **salve nos favoritos** e conferir na semana que vem é um clique.

## 5. Data de fechamento no passado num negócio aberto é mentira

Se a data de fechamento foi no mês passado e o negócio continua aberto, ou ele fechou e ninguém atualizou, ou a data era ficção. As duas coisas precisam de conserto.

Na tabela de negócios, monte os filtros avançados: **Data de fechamento antes de** (a data de hoje), **Estágio não é** Fechado ganho, **Estágio não é** Fechado perdido. Os filtros se combinam com AND; salve o resultado nos favoritos. Uma limitação: datas nos filtros são absolutas, não relativas, então atualize a data quando for revisar. Para cada negócio que aparecer, faça uma de três coisas: mude a data com o motivo numa nota, mude a etapa ou feche.

## 6. Catorze dias sem atividade significa decidir hoje

No quadro kanban, todo negócio aberto sem atividade registrada há mais de 14 dias (ou, se não tem nenhuma atividade, sem edições) ganha um selo visível de "Sem atividade em N dias". Passe o mouse num cartão para ver a idade do negócio; a visão de tabela tem uma coluna Idade. Esses selos não são enfeite. São a lista do que decidir nesta semana.

Para cada negócio marcado, escolha uma:

- **Registre o que aconteceu**: uma ligação, um email, uma reunião, uma nota. Se algo aconteceu e ninguém anotou, anote.
- **Avance**: se o comprador andou, mude a etapa.
- **Feche como perdido**: se o comprador sumiu e dois follow-ups não deram em nada, pare de fingir.

"Deixar e ver no que dá" não está na lista. É assim que se chega a 140 negócios abertos.

## 7. Feche os perdidos rápido, e sempre diga por quê

Times evitam fechar negócios como perdidos porque parece admitir derrota. O resultado é um pipeline inflado de zumbis que tornam a previsão inútil.

No Zerosoft, fechar um negócio como perdido pede um motivo: Preço, Momento, Concorrente, Sem orçamento, Sumiu, Outro, ou um texto seu. Esse motivo fica salvo no negócio e aparece no gráfico de **Motivos de perda** dos relatórios. Depois de um trimestre, esse gráfico diz mais sobre o seu produto e o seu preço do que a maioria das pesquisas. "Sumiu" no topo? A sua qualificação está frouxa demais. "Preço"? Ou o seu pricing ou o seu público-alvo está errado.

Um negócio perdido também não desaparece. Ele fica no registro, com o histórico, e uma tarefa de follow-up para daqui a 90 dias pode trazê-lo de volta.

## 8. Campos personalizados: poucos, e só se alguém usar

Campos custom em negócios são úteis: tipo de negócio, duração do contrato, concorrente na disputa. Também são o jeito mais rápido de entulhar o formulário até ninguém preencher mais nada.

Regra prática: não adicione um campo a menos que um relatório, um filtro ou uma decisão dependa dele. Se ninguém filtrou por ele em dois meses, é móvel de enfeite.

## Para pegar

Regras não sobrevivem sem um ritual. Coloque 30 minutos na agenda toda semana, mesmo dia, time inteiro, e percorram o quadro: selos primeiro, datas de fechamento vencidas depois, negócios sem próxima tarefa por último. Quando a etapa ou o valor de um negócio muda, o Zerosoft guarda um histórico de propriedades no registro, então dá para ver o que mudou desde a semana passada e quem mudou.

O objetivo não é um quadro bonito. É um quadro em que cada cartão aberto significa "alguém está tocando isso, e sabemos quando vamos saber". Quando isso é verdade, a previsão deixa de ser chute e vira ferramenta.
