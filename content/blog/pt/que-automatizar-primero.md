---
title: "O que automatizar primeiro: cinco flows para uma equipe pequena"
description: "Uma regra para escolher o que automatizar e cinco flows concretos que você monta no Flow a partir de modelos: leads, reservas, deals, bugs do chat e cobrança."
date: "2026-10-18"
author: "zerosoft"
tags: ["flow", "automação", "guia"]
---

Listas de "coisas para automatizar hoje" têm um problema em comum: dão ideias, mas não dizem por qual começar. E a primeira automação importa, porque é ela que decide se a equipe vai confiar nas próximas.

Este post tem duas partes. Primeiro, uma regra curta para escolher. Depois, cinco flows que você monta no Flow em poucos minutos, cada um com seu gatilho, seus passos e o detalhe que costuma quebrar.

## A regra: frequência vezes o custo de esquecer

Antes de abrir o editor, anote cada tarefa repetitiva da equipe e coloque dois números do lado:

- **Quantas vezes por semana acontece.** Um lead novo pode acontecer trinta vezes. O fechamento do mês, uma.
- **Quanto custa alguém esquecer.** Um lead que ninguém liga por dois dias esfria. Uma linha faltando numa planilha interna quase não custa nada.

Multiplique. O que ficar em cima vem primeiro. Depois aplique dois filtros:

1. **A regra cabe numa frase.** "Cada formulário cria um contato e avisa no #vendas" dá para automatizar. "Responder clientes irritados no tom certo" ainda precisa de uma pessoa.
2. **Um erro dá para desfazer.** Uma mensagem duplicada no Slack incomoda. Uma cobrança duplicada é um problema. Comece pelo que é reversível.

Com essa lista ordenada, estes são os cinco flows que mais aparecem no topo de uma equipe pequena.

## 1. Lead de formulário: contato no CRM e aviso no Slack

**Gatilho:** o evento `form.submitted` do CRM.
**Passos:** "CRM: criar contato" com o email e o nome do envio, e depois uma mensagem no Slack.

O modelo "Lead de formulário → CRM + Slack" já vem pronto. O texto do aviso usa os dados do evento:

```
Novo lead de {{trigger.form.name}}: {{trigger.submission.values.email}} ({{trigger.utm.utm_source | default:direct}})
```

O filtro `default:direct` evita uma mensagem com buraco quando o lead não traz UTMs. Se suas UTMs seguem uma convenção, esse aviso já diz de qual campanha veio (escrevemos uma em [UTMs sem planilha](/blog/utms-sin-planilla)).

**O que quebra:** spam nos formulários. Coloque um nó Filtro antes do contato, com a condição de que o email exista e não contenha o domínio que te manda lixo. Se o filtro não passa, o ramo para e o contato não é criado.

## 2. Reserva nova: tarefa para preparar a reunião

**Gatilho:** `booking.created` do Cal.
**Passo:** "Track: criar issue" no projeto que você escolher.

O modelo "Nova reserva no Cal → tarefa no Track" monta o título com o tipo de evento e o nome do convidado. Em português ficaria assim:

```
Preparar: {{trigger.eventType.title}} com {{trigger.invitee.name}}
```

Na descrição entram o email do convidado e o horário. Se você prefere uma planilha, o modelo "Nova reserva → linha no Google Sheets" adiciona uma linha por reserva com data, nome, email e evento.

**O que quebra:** reservas canceladas. Monte um segundo flow com `booking.cancelled` que avise, senão a tarefa continua aberta para uma reunião que não existe mais.

## 3. Resumo diário de deals novos

**Gatilho:** Agendado, todo dia às 09:00, no seu fuso horário.
**Passos:** "CRM: deals recentes" (últimas 24 horas), um Filtro que só segue se houver pelo menos um, e um email.

O corpo do email lista os nomes com dois filtros encadeados:

```
{{nodes.deals.output.deals | map:name | lines}}
```

O Filtro do meio importa mais do que parece: um resumo que chega vazio cinco dias seguidos ensina todo mundo a ignorá-lo.

**O que quebra:** o horário, menos do que antes. No zerosoft Cloud o agendador verifica a cada minuto, então um flow das 09:00 começa cerca de um minuto depois das 09:00. Com self-host, segue a frequência com que você chama `/api/cron/minute` ou `/api/cron/tick`: com o tick uma vez por hora, um flow pode começar até uma hora atrasado. Para um resumo diário, qualquer um dos dois basta. Para algo que precisa sair num segundo exato, o Flow não foi feito para isso.

## 4. Bug relatado no chat: issue no Track

**Gatilho:** `message.received` do Chat.
**Passos:** "AI: gerar texto" para classificar a mensagem, um nó Se, e "Track: criar issue" no ramo verdadeiro.

A instrução do passo de IA é curta de propósito. Algo assim:

```
Responda só "bug" se a mensagem relata um bug ou um erro. Senão, responda "other".
```

Com um teto de 10 tokens, a saída é uma palavra e o Se compara com `contains`. O modelo "Bug relatado no chat → issue no Track" já traz isso pronto.

**O que quebra:** confiar cegamente na classificação. Nas primeiras semanas, olhe o histórico de execuções: cada uma guarda o que entrou e o que saiu de cada nó, então você vê quais mensagens a IA marcou como bug e quais não. Esse passo usa sua cota de IA.

## 5. Deal ganho: cliente no Stripe

**Gatilho:** `deal.won` do CRM.
**Passo:** o nó do Stripe com a operação "criar cliente".

O modelo "Deal ganho → cliente no Stripe" preenche o nome e uma descrição com o valor. Você precisa de uma credencial do Stripe, que fica guardada criptografada e oculta nos logs de cada execução.

**O que quebra:** a duplicação. É o único dos cinco que mexe com dinheiro e, pela regra do começo, deveria ser o último a ser ativado. O Flow manda ao Stripe uma chave de idempotência por execução e por nó, então uma nova tentativa da mesma execução não cria dois clientes. Se alguém marca o deal como ganho duas vezes, são duas execuções diferentes: adicione um Filtro ou confira no Stripe antes de confiar totalmente.

## Quanto custa cada um

No Zapier, cada ação executada é uma tarefa. O plano Team começa em [US$ 103,50 por mês com 2.000 tarefas](https://zapier.com/pricing). Como exemplo: com 30 formulários por dia, o flow 1 faz duas ações por envio, umas 1.800 tarefas por mês. Só ele já chega perto do teto, e faltam os outros quatro.

O Flow no seu servidor não cobra por tarefa. Existem limites para que um loop mal montado não derrube nada: 1.000 execuções por hora por workspace, 200 passos por execução e 300 emails por dia pelo nó Enviar email, todos configuráveis com self-host.

## O que o Flow ainda não tem

Fora dos apps da zerosoft, o Flow tem nós para Slack, Google Sheets, Gmail, Stripe, Notion, Discord e Telegram. Para o resto existe um nó de requisição HTTP para qualquer API pública via HTTPS e um webhook de entrada com URL secreta. Se a ferramenta que você usa não tem API, o Flow não alcança. Também não há importador de zaps: cada flow é montado de novo, o que leva minutos com os modelos.

## Por onde começar

Faça a lista de frequência vezes custo, escolha o que ficar em cima e abra o Flow a partir de um modelo. Rode com o botão Testar e dados reais, confira a saída de cada nó e só então ative. Quando algo falhar, e em algum momento algo vai falhar, a próxima leitura é [o que fazer quando um flow falha](/blog/cuando-un-flow-falla).
