---
title: "Aprovações humanas em um flow: pausar, perguntar e seguir"
description: "Como colocar uma pessoa no meio de uma automação: o nó Aprovação do Flow, o que acontece se ninguém responde, como usar o comentário e um exemplo completo com descontos."
date: "2026-10-30"
author: "zerosoft"
tags: ["flow", "automação", "aprovações"]
---

Algumas decisões não devem ser automatizadas. Um reembolso grande, um desconto fora da tabela, um gasto acima do teto do mês. O que dá para automatizar é tudo ao redor da decisão: juntar os dados, perguntar para a pessoa certa, esperar a resposta e executar o que couber quando ela chegar.

Isso se chama "humano no meio". A Zapier dedicou um [guia inteiro](https://zapier.com/blog/human-in-the-loop-guide/) e um passo próprio ao tema, e o n8n tem a operação [Send and Wait for Response](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.respondtochat/). O Flow resolve com um nó, Aprovação. Este guia explica como ele se comporta de verdade, incluindo os casos incômodos: ninguém responde, duas pessoas respondem ao mesmo tempo, alguém abre o link sem querer.

## O que o nó faz

Aprovação pausa a execução e envia um pedido por email para até 10 pessoas. Se você escolher uma credencial do Slack, ele também publica em um canal com dois botões. Cada destinatário recebe links assinados que abrem uma página onde pode aprovar ou rejeitar e deixar um comentário opcional.

O nó tem duas saídas, **Aprovado** e **Rejeitado**. Você conecta em cada uma o que deve acontecer, sem um nó de condição no meio.

Campos que você vai preencher:

- **Quem aprova:** emails separados por vírgula. Aceita variáveis, então `{{trigger.manager_email}}` funciona.
- **Assunto e O que precisa de aprovação:** também aceitam variáveis. Coloque aqui todo o contexto para decidir sem abrir outra aba.
- **Pedir também no Slack:** opcional, com credencial e canal.
- **Tempo limite e Se ninguém responder**, em Avançado.

## Vale a primeira resposta

Se você enviar o pedido para três pessoas, decide quem responder primeiro. As outras duas, ao abrir o link, veem que o pedido já foi respondido. Não precisam combinar nada e não existe um modo "todos precisam aprovar". Se a sua regra é "duas assinaturas", encadeie dois nós Aprovação, cada um com seu grupo.

Isso simplifica o desenho: o pedido vai para um grupo que pode decidir (por exemplo, as três pessoas de vendas com permissão para dar descontos) e se resolve quando alguém pega.

## Um link aberto não é uma decisão

Os links de aprovação levam `?decision=approve` ou `?decision=reject`. Você pode pensar que abri-los já decide, mas não: a página mostra a opção escolhida e espera que você confirme com um botão. O motivo é prático. Muitos serviços de email e segurança abrem os links das mensagens para escaneá-los, e se um GET aprovasse, um scanner aprovaria reembolsos por você.

Vale o mesmo para o Slack: os botões abrem a página, não decidem sozinhos.

## O que acontece se ninguém responde

Cada pedido nasce com um prazo. O padrão são 3 dias, e você pode definir em horas ou dias. Ao vencer, o nó faz o que você configurou em **Se ninguém responder**:

- **Rejeitar** (o padrão): a execução segue pela saída Rejeitado. É o mais prudente quando há dinheiro envolvido.
- **Aprovar:** segue por Aprovado. Serve para pedidos de baixo risco em que o silêncio significa "pode ir", como pedir acesso a uma ferramenta de teste.
- **Falhar:** a execução termina com o erro `approval_timeout`, e vale tudo o que você já sabe de [quando um flow falha](/blog/cuando-un-flow-falla): flow de erro, alerta, reexecução a partir do nó.

O prazo é resolvido pelo worker do Flow, então pode chegar um pouco depois do horário exato, conforme a frequência do seu cron. Considere isso em prazos de horas. O email informa ao destinatário a data de vencimento.

## Que dados a decisão deixa

Depois do nó, os passos seguintes podem ler:

- `{{nodes.<id>.output.approved}}`: verdadeiro ou falso.
- `{{nodes.<id>.output.decision}}`: `approved` ou `rejected`.
- `{{nodes.<id>.output.comment}}`: o que a pessoa escreveu (vazio se não escreveu ou se venceu).
- `{{nodes.<id>.output.decidedAt}}`: quando foi decidido.
- `{{nodes.<id>.output.timedOut}}`: verdadeiro se quem decidiu foi o prazo e não uma pessoa.

O comentário é a parte mais útil. Uma rejeição sem motivo gera três rodadas de mensagens. Uma rejeição com motivo pode ser encaminhada como está para quem pediu.

## Exemplo: descontos acima de 20%

O caso: alguém de vendas precisa oferecer um desconto maior que o permitido, e o responsável comercial precisa autorizar antes de a proposta sair.

```
Webhook (desconto solicitado: deal, valor, percentual, motivo, email do vendedor)
  → Filtro: percentual > 20
  → Aprovação
      Quem aprova:        comercial@suaempresa.com
      Assunto:            Desconto de {{trigger.percent}}% para {{trigger.deal}}
      O que aprovar:      Pedido por: {{trigger.seller_email}}
                          Valor de tabela: {{trigger.amount}}
                          Motivo: {{trigger.reason}}
      Tempo limite:       1 dia. Se ninguém responder: rejeitar.
  → [Aprovado]   Enviar email ao vendedor: "Aprovado. {{nodes.aprovacao.output.comment}}"
  → [Rejeitado]  Enviar email ao vendedor: "Não aprovado. Motivo: {{nodes.aprovacao.output.comment}}"
```

Se os seus deals estão no CRM do zerosoft, o gatilho pode ser um evento do próprio CRM, como `deal.updated`, no lugar de um webhook. O resto do flow não muda.

## Limites que convém conhecer

- **Não dá para usar dentro de um Loop.** Um pedido por item de uma lista de cem seriam cem emails, e o editor não deixa montar. Se precisa aprovar um lote, junte um resumo em um único pedido antes do Loop.
- **Até 10 destinatários** por nó.
- **A execução fica em espera** e, ao retomar, segue a partir desse nó com o contexto que tinha.
- **O pedido vai por email ou Slack.** Quem aprova abre uma página pública assinada e não precisa de conta no zerosoft. Segundo a [documentação da Zapier](https://help.zapier.com/hc/en-us/articles/38733184458765/), o revisor entra na própria conta da Zapier para decidir. Para aprovar com alguém de fora (um cliente, um contador), a primeira forma é mais adequada.
- **Não edita dados.** A pessoa decide e comenta, mas não altera os campos do pedido. Se precisa que ela corrija um valor, use "Esperar até uma chamada" e um formulário seu que retome a execução.

## Quando não colocar uma aprovação

Cada aprovação acrescenta espera e pede a atenção de uma pessoa. Uma regra para decidir:

1. Se o erro é fácil de corrigir depois (uma tag errada), não peça permissão: aja e avise.
2. Se o erro custa dinheiro ou confiança (um reembolso, um email para todos os clientes), peça aprovação.
3. Se a mesma pessoa aprova 100% dos pedidos durante um mês, o controle não está filtrando nada. Transforme em uma regra automática.

## Como testar antes de deixar rodando

Envie o pedido para você mesmo, com prazo de 15 minutos, e percorra os três caminhos: aprovar com comentário, rejeitar e deixar vencer. Fixe dados de teste no gatilho para repetir sem recarregar nada. Depois olhe o histórico da execução e confirme que o passo aparece como em espera e depois como bem-sucedido, com a saída esperada.

Se você está começando no Flow, [o que automatizar primeiro](/blog/que-automatizar-primero) traz cinco flows para começar, e todos aceitam uma aprovação no ponto em que o risco pedir.
