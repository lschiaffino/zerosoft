---
title: "O lock-in não é um efeito colateral do SaaS: é o produto"
description: "Export incompleto, formatos proprietários, integrações que quebram, preços que escalam com o seu sucesso. Não são acidentes: são a estratégia."
date: "2026-06-16"
author: "Zerosoftware"
tags: ["lock-in", "saas", "open source"]
---

Quando você avalia uma ferramenta de SaaS, olha os recursos, o preço de entrada e a interface. O fornecedor, por outro lado, olha outra coisa: quanto vai custar para você sair. Esse número — o seu custo de saída — é o ativo mais valioso que ele tem. O lock-in não é um efeito colateral do modelo. É o modelo.

## As quatro táticas de sempre

**1. O export incompleto.** O botão existe, então tecnicamente "você pode levar seus dados". O que você leva são os contatos. O que fica: o histórico de atividades, as notas, os anexos, as automações que você construiu durante anos. Você leva os tijolos; eles ficam com a casa.

**2. Formatos proprietários.** Seus dados saem num formato que só aquela ferramenta entende — ou num CSV tão degradado que reconstruir as relações entre tabelas leva semanas. Tecnicamente exportável, na prática inútil.

**3. Integrações que quebram.** Enquanto você está dentro, tudo se conecta com tudo. No dia em que você anuncia que vai sair, descobre que essas integrações eram a cola da sua operação: o formulário do site, o sync com o faturamento, o webhook que dispara o seu pipeline. Sair não custa a assinatura: custa refazer metade da empresa.

**4. Preços que escalam com o seu sucesso.** O pricing por contato, por assento, por "registro" tem uma propriedade elegante e perversa: a sua fatura cresce quando o seu negócio cresce. Você dobrou a base de clientes, dobrou a fatura. O seu crescimento é o modelo de receita deles. Você não paga por mais software — o software é o mesmo — paga por ter dado certo.

## Como detectar antes de assinar

Não precisa de fé, precisa de dez minutos de due diligence:

- **Exporte no dia um.** Crie dados de teste e teste o export antes de migrar qualquer coisa. Se o que sai não dá para reconstruir a sua operação, você já sabe quanto vale esse botão.
- **Olhe a curva de preços em 10x.** Calcule quanto pagaria com dez vezes os seus usuários, contatos ou registros atuais. Se o número incomoda hoje, vai doer em dois anos.
- **Leia os limites da API.** Rate limits baixos e uma API de brinquedo são um sinal: eles não querem que os seus dados saiam pela porta dos fundos.
- **Pergunte pelo formato.** Eles documentam o modelo de dados? Exportam em formatos abertos (CSV, JSON, ICS, vCard) ou só no deles?

## A alternativa: ser dono

A única defesa estrutural contra o lock-in é a propriedade. Software cujo código você pode baixar, cujo banco de dados está no seu servidor — ou numa nuvem cobrada ao custo, da qual você sai numa tarde.

Na Zerosoftware funciona assim: todo o código é open source; se você usa a nossa nuvem, paga o que a infraestrutura custa, sem margem; e os seus dados saem completos, em formatos abertos, com um clique. Se um dia fizermos as coisas mal, sair tem que ser fácil. Ficar deve ser uma decisão, não uma condenação.
