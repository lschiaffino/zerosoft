---
title: "Carrinhos abandonados: como recuperá-los no Shop sem outra ferramenta de email"
description: "O que o Shop guarda quando alguém sai do checkout, como ver e recuperar esses carrinhos, quando vale ativar o lembrete e quais são os limites hoje."
date: "2026-11-19"
author: "zerosoft"
tags: ["shop", "ecommerce", "carrinhos abandonados"]
---

Alguém chega na sua loja, escolhe dois produtos, digita o email no checkout e vai embora. Acontece em quase toda loja pequena, e cada uma dessas pessoas já fez a parte difícil: encontrou você e decidiu o que queria. Recuperar ao menos uma parte desses pedidos rende mais do que atrair visitas novas.

A Shopify tem um [guia sobre emails de carrinho abandonado](https://www.shopify.com/ca/blog/abandoned-cart-emails) que cobre como escrevê-los e quando enviar. É uma boa base se você já usa a Shopify. Aqui vai a versão do Shop, a loja online da zerosoft: o que ele guarda, como recuperar um carrinho na mão, como ativar o lembrete automático e o que ainda não faz. Tudo isso vem do código, que é aberto.

## O que o Shop guarda quando alguém sai

Assim que a pessoa digita o email no checkout, o Shop guarda uma linha com o carrinho: produtos, quantidades, subtotal e moeda. Não guarda endereço nem dados de pagamento, porque nesse ponto ainda não foram preenchidos.

Há uma linha por loja e por email. Se a mesma pessoa volta e muda o carrinho, a linha é sobrescrita pela versão mais nova, sem duplicar. Se o carrinho vira pedido, a linha passa a "recuperado" e deixa de aparecer como abandonada.

Um checkout só conta como abandonado depois de uma hora sem mudanças. Antes disso a pessoa pode estar procurando o cartão. As linhas são apagadas após 30 dias.

## Passo 1: olhar a lista

Abra **Carrinhos abandonados** no Shop. Cada linha mostra o cliente, a quantidade de itens, o subtotal, a última atividade e o status: sem recuperar, lembrete enviado, pediu para não receber ou recuperado (com atalho para o pedido).

Com o lembrete automático desligado, a lista funciona do mesmo jeito. Cada carrinho tem um botão para copiar o link de recuperação e enviá-lo você mesmo pelo canal que já usa com seus clientes: uma mensagem de WhatsApp, um email da sua caixa, uma resposta no Chat. Também há um botão para mandar o lembrete na mão, com o mesmo texto e os mesmos limites do automático, uma única vez por checkout.

O link abre a loja com o carrinho montado como a pessoa deixou. Ele leva um token longo e aleatório e só funciona enquanto o carrinho continua aberto. Se o pedido foi concluído, deixa de funcionar.

## Passo 2: decidir se ativa o lembrete

Nas configurações da loja há duas opções:

- **Enviar um lembrete a quem sai do checkout.** Vem desligado.
- **Horas de espera.** Entre 1 e 72, padrão 4.

O lembrete sai de um cron, não da sua caixa de entrada, e só se a loja estiver publicada. Estas são as regras que o código aplica, todas fixas:

1. **Um único email por checkout.** Mesmo que a pessoa mude o carrinho cinco vezes, recebe um.
2. **Link de descadastro** no corpo e também o cabeçalho `List-Unsubscribe` com saída em um clique. Quem se descadastra fica fora dos lembretes dessa loja.
3. **Limite por destinatário:** dois lembretes por semana na mesma loja e três por dia somando todas as lojas da zerosoft.
4. **Limite para loja nova:** nos primeiros 7 dias há um teto diário mais baixo (10 lembretes por dia).
5. **Sem tentativas em loop.** Se o envio falha ou um limite o barra, não se tenta de novo: um lembrete que chega tarde já não ajuda.

Os limites existem porque qualquer pessoa pode digitar qualquer endereço num checkout, e o email sai com o remetente do app. Sem limites, uma loja recém-criada serviria para mandar email a terceiros.

## Quantas horas esperar

Não temos dados próprios para dar um número ideal, e não vamos inventar um. O que você pode raciocinar com o seu caso:

- **Produtos de compra rápida** (acessórios, comida, presentes): uma a quatro horas. A intenção ainda está fresca.
- **Compras pensadas** (móveis, equipamentos, cursos): entre 12 e 24 horas. A pessoa pode estar comparando ou consultando alguém.
- **Se você vende por WhatsApp ou atende pessoalmente:** deixe o automático desligado e escreva na mão para os carrinhos de maior valor.

Comece com as 4 horas padrão e veja a lista de carrinhos recuperados depois de uma ou duas semanas. Se quase ninguém volta, teste 24.

## Um fluxo que dá para montar hoje

Uma rotina de cinco minutos por dia para uma loja pequena:

1. Abra a lista de carrinhos abandonados.
2. Escreva você mesmo para os três ou quatro de maior valor (o subtotal aparece na linha), com o link de recuperação. Uma mensagem curta basta: "Vimos que você deixou o pedido pela metade. Guardamos seu carrinho aqui: [link]. Se algo deu errado com o pagamento ou a entrega, nos conte."
3. Deixe o lembrete automático para o resto.
4. Toda semana, anote quantos carrinhos passaram a recuperados e em quais você tinha escrito na mão.

Cada pedido pago cria ou atualiza o contato no CRM e registra o pedido na ficha, então dá para ver o que comprou quem voltou.

## O que ainda não faz

Para você não montar a estratégia em cima de algo que não existe:

- **O texto do email é fixo.** Não há modelo editável nem como incluir desconto ou código no lembrete.
- **É um único lembrete.** Sem sequências de dois ou três emails.
- **Sem SMS ou WhatsApp automáticos** para carrinhos. O link é copiado e enviado na mão.
- **Sem segmentação** por valor do carrinho ou por cliente novo versus recorrente.

Se quiser um desconto numa segunda mensagem, hoje isso se resolve na mão: crie um cupom de desconto no Shop e envie junto com o link de recuperação, da sua própria caixa de email.

A tabela de paridade com a Shopify na página do Shop marca esses pontos como parciais, com data de revisão.

## Por que fazemos assim

Uma ferramenta de email separada para carrinhos abandonados costuma significar outra conta, outra fatura e os dados dos seus clientes com um terceiro. No Shop, o carrinho, o cliente e o pedido vivem no mesmo banco. Se você faz self-host, esse banco está no seu servidor e o custo do software é $0.

E os limites por destinatário, que às vezes parecem uma restrição, são a parte que consideramos certa: um lembrete útil é um email, não cinco.
