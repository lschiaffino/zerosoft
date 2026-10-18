---
title: "Follow-up de vendas: uma sequência de cinco toques que para sozinha"
description: "Uma cadência de follow-up de duas semanas com emails, uma tarefa e esperas em dias úteis, os textos para copiar e como montar tudo nas sequências do CRM do zerosoft."
date: "2026-10-18"
author: "zerosoft"
tags: ["crm", "vendas", "email", "modelos"]
---

Follow-ups falham de dois jeitos. O primeiro: ninguém manda, porque o lembrete estava na cabeça de alguém. O segundo, mais caro: saem mesmo assim quando o contato já respondeu ou já agendou, e o terceiro "conseguiu ver meu email?" chega para alguém que ontem disse sim.

A HubSpot tem uma página muito visitada com [16 modelos de email de follow-up](https://www.hubspot.com/sales/sales-follow-up-email), organizados por situação: depois de uma reunião, depois de um evento, depois de várias tentativas. Servem de inspiração para um email avulso. O que eles não dão é a cadência completa: quantos toques, quanto esperar e, principalmente, quando parar. Este post monta isso: uma sequência de duas semanas com os textos e a configuração no CRM do zerosoft.

## O que uma sequência faz no CRM

O suficiente para as decisões abaixo fazerem sentido:

- **Três tipos de passo:** email (de um modelo ou escrito ali), tarefa e espera de N dias.
- **Mesma thread por padrão.** Cada email sai como resposta na thread do primeiro, com "Re:" e os cabeçalhos certos. Você pode marcar um passo para começar uma thread nova.
- **Dias úteis e janela de envio.** A sequência tem fuso horário, uma janela (por exemplo, das 9 às 17) e a opção de pular fins de semana. Um email que vence às 22h sai às 9h do próximo dia útil.
- **Saídas automáticas.** A inscrição para se o contato responde (o sync do Gmail detecta), agenda uma reunião no Cal ou cancela a inscrição pelo link do rodapé. É isso que evita o segundo erro lá de cima.
- **Variáveis com valor padrão.** `{{contact.first_name | tudo bem}}` coloca o nome ou, se faltar, "tudo bem". Também há empresa, cargo, nome do negócio, dados do responsável e campos personalizados.

Dois detalhes operacionais. Os passos rodam a partir de um cron que passa a cada hora, então um email sai dentro da hora em que vence. E os emails saem do Gmail de quem inscreve o contato: é preciso conectar o Gmail, e enquanto o Google não terminar de verificar o app, só usuários de teste conseguem conectar.

## A cadência: cinco toques em duas semanas

| Dia útil | Passo | O que busca |
|---|---|---|
| 0 | Email 1 | Contexto e uma pergunta |
| 2 | Email 2, mesma thread | Algo útil, sem pedir nada novo |
| 5 | Tarefa: ligação ou mensagem no LinkedIn | Mudar de canal |
| 7 | Email 3, mesma thread | Outro ângulo do problema |
| 12 | Email 4, mesma thread | Fechamento: continuo ou não? |

No editor fica assim: email, espera 2, email, espera 3, tarefa, espera 2, email, espera 5, email. Um detalhe: o passo de tarefa cria a tarefa para o responsável e a sequência segue na hora para o passo seguinte. Por isso depois da tarefa vem uma espera; sem ela, o email 3 sairia no mesmo minuto.

Por que cinco toques? Nenhuma razão universal. A página da HubSpot repete que a maioria das vendas precisa de pelo menos cinco follow-ups, mas não linka o estudo, então não vamos usar esse número como argumento. Comece com cinco e deixe suas estatísticas decidirem (veja abaixo).

## Os textos

Escritos para B2B; adapte ao seu produto. Uma regra para todos: no máximo um pedido por email.

**Email 1. Assunto: `{{contact.company}} e [tema]`**

> Oi, {{contact.first_name | tudo bem}}? Vi que [fato concreto: preencheram o formulário de preços, abriram uma vaga de vendas, usam X]. Em times parecidos, o que costuma travar é [problema concreto]. Acontece algo assim com vocês? Se sim, te mostro em dez minutos como resolvemos.
> {{owner.first_name}}

**Email 2 (mesma thread)**

> Deixo aqui [recurso concreto: um modelo, uma comparação de custos, um caso com números]. É útil mesmo que a gente nunca converse. Se servir, a pergunta de cima continua de pé.

**Tarefa: "Ligar ou escrever no LinkedIn para {{contact.full_name}}"**

Nas notas da tarefa, deixe um roteiro de duas linhas: quem você é e a mesma pergunta do email 1. Um canal diferente não pede uma mensagem diferente.

**Email 3 (mesma thread)**

> Outro jeito de ver: [o custo do problema, com um número que o contato possa verificar]. Se não for prioridade neste trimestre, me avise e escrevo mais para frente.

**Email 4 (mesma thread)**

> Não quero lotar sua caixa de entrada. Se não for o momento, responda "agora não" e encerro o assunto. Se for outra pessoa que cuida disso na {{contact.company}}, pode me dizer quem?

Três coisas que não entram em nenhum: "só passando para fazer follow-up", um "Re:" falso num email que não é resposta e um anexo pesado no primeiro toque.

## Quem inscrever e de onde

Uma sequência é para quem mostrou alguma intenção ou tem um encaixe muito bom. As portas de entrada no CRM:

- **Pela ficha do contato ou em lote** na lista, com a barra de ações. Quem já está inscrito, cancelou a inscrição ou não tem email fica de fora, e o CRM diz quantos.
- **Por um formulário:** cada envio pode inscrever o contato numa sequência.
- **Por um workflow:** por exemplo, quando o lead score passa de 30 para cima. Montamos essas regras em [lead scoring com regras](/blog/lead-scoring-con-reglas).
- **Pelo Flow ou pela API**, se o sinal vem de outro sistema.

## Leia as estatísticas por passo

A sequência mostra enviados, abertos, com clique e respondidos em cada passo. Depois de 30 ou 40 inscritos, três perguntas:

1. **Qual passo junta mais respostas?** Se é o email 4, os anteriores pedem demais ou dizem pouco. Reescreva o email 2 antes de adicionar um sexto toque.
2. **Quantos saem antes do fim?** A lista de inscrições mostra o motivo de cada saída: respondeu, agendou uma reunião, cancelou a inscrição. Muitos cancelamentos no email 3 costumam indicar uma lista mal escolhida. Revise quem você inscreveu antes de mexer no texto.
3. **Os cliques viram respostas?** Se há cliques no recurso do email 2 e ninguém responde, a pergunta de fechamento não conversa com o que leram.

Desconfie das aberturas: o Apple Mail pré-carrega imagens e registra aberturas que não aconteceram.

## O que ainda não faz

- Só Gmail. Outlook não está.
- Não há teste A/B de assunto nem de corpo dentro de uma sequência. Para comparar, duplique a sequência e divida os inscritos à mão.
- Os passos saem com granularidade de uma hora.
- A tarefa do LinkedIn é uma tarefa: não automatizamos mensagens em outras plataformas.

As sequências rodam no CRM do zerosoft por $0 no seu servidor ou no zerosoft Cloud, onde você paga pelos emails enviados e não por assento.
