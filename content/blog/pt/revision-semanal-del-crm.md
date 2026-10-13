---
title: "A revisão semanal do CRM em 30 minutos"
description: "Um ritual semanal para times de vendas pequenos: um painel, algumas visualizações salvas, duas listas dinâmicas e um relatório que roda. O que olhar, em que ordem e o que fazer com o que você encontrar."
date: "2026-09-06"
author: "zerosoft"
tags: ["crm", "relatórios", "playbook"]
---

A maioria dos times olha o CRM em dois modos: na correria, na véspera de uma reunião de diretoria, e nunca, no resto do tempo. Nenhum dos dois funciona. O primeiro produz números em que ninguém confia; o segundo produz um CRM que ninguém atualiza, que é exatamente como você acaba no primeiro.

A solução é chata e eficaz: trinta minutos, uma vez por semana, mesmo dia, com uma pauta que não muda. Esta é a que nós rodaríamos, montada em cima do que o zerosoft CRM tem de verdade: painéis, relatórios, visualizações salvas e listas dinâmicas.

## Monte uma vez (uns 20 minutos)

A revisão só leva 30 minutos se você não construir nada durante ela. Faça isto uma única vez.

### Um painel "Revisão semanal"

Em `/app/crm/dashboards`, crie um painel e adicione estes widgets:

- **KPI** ×4: novos contatos, novos negócios, valor ganho e atividades. Cada widget de KPI escolhe uma métrica, um pipeline opcional e um período (7 dias, 30 dias, 90 dias, trimestre ou 12 meses). Para uma revisão semanal, use 7 dias.
- **Previsão ponderada**: o pipeline aberto ponderado pela probabilidade de cada etapa.
- **Funil do pipeline**: quantos negócios há em cada etapa.
- **Ganhos vs perdidos**: a tendência por mês.
- **Tarefas abertas** e **Ranking de atividade**: quem está fazendo o trabalho e o que está pendente.

Nove widgets, uma tela. Você pode ter vários painéis (um por pipeline, por exemplo), mas para a revisão semanal um basta.

### Três visualizações salvas de negócios

Na tabela de negócios, com os filtros avançados, salve:

1. **Fechamento vencido**: data de fechamento antes de hoje, estágio não é Fechado ganho, estágio não é Fechado perdido.
2. **Sem valor**: ordenado por valor, crescente.
3. **Meus, abertos**: owner é você, estágio não é Fechado ganho, estágio não é Fechado perdido.

Uma ressalva: as datas dos filtros são absolutas, não "hoje" no sentido relativo. Atualize a data da primeira visualização toda semana; leva cinco segundos.

### Duas listas dinâmicas

Em `/app/crm/lists`, crie duas listas **dinâmicas**. Uma lista dinâmica é um filtro que se recalcula toda vez que você a abre:

- **Leads intocados**: status do lead = Novo.
- **Momento ruim**: status do lead = Momento ruim.

A primeira é a sua fila de triagem. A segunda é a pilha de gente que disse "agora não", que é o pipeline mais barato que você vai ter na vida.

## A pauta

Mesma ordem toda semana. Use um timer se precisar.

### Minutos 0–5: os números

Abra o painel. Leia os quatro KPIs em voz alta. Cada um mostra a variação em relação ao período anterior de mesmo tamanho, então o "valor ganho" dos últimos 7 dias vem com a comparação com os 7 dias anteriores.

Ainda não discutam. Só anote o que surpreender: uma queda nas atividades, um pico de contatos novos, uma semana com zero ganhos. Essas são as perguntas para o resto da reunião.

### Minutos 5–15: o quadro

Este é o coração da revisão. Abra o quadro de negócios e percorra da esquerda para a direita.

- **Selos de "Sem atividade em N dias".** Todo negócio aberto sem atividade há mais de 14 dias fica marcado no cartão. Para cada um, o owner diz uma frase: o que vem a seguir e quando. Se não houver resposta, ele é fechado como perdido (com motivo) antes do fim da reunião.
- **Visualização de fechamento vencido.** Para cada negócio: nova data com motivo, nova etapa ou fechamento.
- **Visualização sem valor.** Preencha, ou admita que você não sabe o suficiente para chamar aquilo de negócio.

Dez minutos passam rápido. Se o quadro é grande demais para percorrer em dez minutos, essa já é a descoberta: você tem negócios abertos demais para o tamanho do seu time.

### Minutos 15–20: tarefas

Abra `/app/crm/tasks` e olhe **Atrasadas**, filtrado por owner. Sem expor ninguém: reagende ou feche. Uma tarefa atrasada há duas semanas é uma tarefa que ninguém vai fazer. Apague ou transforme numa decisão.

### Minutos 20–25: listas

Abra as duas listas dinâmicas. A contagem de membros aparece direto na página de listas.

- **Leads intocados** deveria estar perto de zero. Se cresce semana após semana, os leads chegam mais rápido do que vocês trabalham. Atribua agora, ou mude a forma de qualificar.
- **Momento ruim**: escolha três pessoas que disseram "agora não" há mais de um trimestre e atribua uma tarefa de retomada. Três por semana são 150 por ano.

### Minutos 25–30: um relatório, em rodízio

`/app/crm/reports` tem sete visões: Visão geral, Funil, Previsão, Origens, Responsáveis, Atividade e Conversão. Cada uma aceita um período (7d, 30d, 90d, trimestre, 12m), um agrupamento (dia, semana, mês, trimestre) e filtros por pipeline, origem, prioridade e owner. Não olhe todas toda semana; faça rodízio:

- **Semana 1, Funil.** Conversão de etapa para etapa. Onde está a maior queda? Esse é o foco do mês que vem.
- **Semana 2, Origens.** Contatos, negócios e valor por origem. O canal que traz mais leads é também o que traz mais pipeline?
- **Semana 3, Visão geral.** Motivos de perda, ganhos vs perdidos, dias médios até o fechamento. Se "Sumiu" lidera os motivos de perda, o problema é o seu follow-up, não o seu pitch.
- **Semana 4, Conversão e Responsáveis.** Ganhos divididos por criados no período, comparado com o período anterior, e o detalhamento por owner: ganhos, perdidos, taxa de vitória e atividades concluídas. Use para ver quem precisa de ajuda, não para montar um ranking.

Quando uma configuração de relatório for útil, salve com **Salvar relatório** e no mês que vem é um clique.

## O que esta revisão não é

Não é uma call de previsão com o CEO. Não é uma sessão de coaching. Não é onde você redesenha o pipeline. Se alguma dessas coisas aparecer, anote e agende à parte. A revisão funciona porque é curta e previsível.

Dois limites honestos:

- **Os relatórios não convertem moedas.** Os valores são somados numa única moeda por relatório. Se você vende em várias, filtre por pipeline ou leve isso em conta ao ler os totais.
- **Não há relatórios agendados por email.** Ninguém recebe um PDF na segunda de manhã. A revisão é o mecanismo de entrega.

## Por que funciona

Uma revisão semanal não é sobre os números. É sobre todo mundo saber que na segunda às 10 os seus negócios vão estar na tela. Essa pressão pequena e previsível é o que faz as pessoas registrarem a ligação na quinta, em vez de "depois".

Trinta minutos por semana são duas horas por mês. É a ferramenta de vendas mais barata que você vai comprar, e você já tem.
