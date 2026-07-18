---
title: "O custo real da nuvem, em números públicos"
description: "Um VPS custa US$ 5. Um GB de storage custa centavos. A banda vem por terabyte. Tudo isso é público — e é exatamente o que o SaaS não quer que você some."
date: "2026-06-10"
author: "Zerosoftware"
tags: ["custos", "nuvem", "transparência"]
---

Os preços da nuvem são públicos. Qualquer um pode abrir a página de preços de qualquer provedor e ver quanto custa um servidor, um GB de armazenamento, um terabyte de tráfego. Quase ninguém faz isso. A indústria do SaaS construiu suas margens em cima dessa preguiça. Vamos à conta.

## A tabela de preços que todo mundo pode ler

| Recurso | Preço público típico |
| --- | --- |
| VPS (1 vCPU, 1GB RAM, 25GB disco, 1TB de transferência inclusa) | US$ 5/mês |
| Object storage | ~US$ 0,02 por GB/mês |
| Banda adicional | centavos por GB (e 1TB já incluso) |
| Domínio próprio | ~US$ 10/ano |
| SQLite como banco de dados | US$ 0 |

Com essa tabela você roda, literalmente, a maioria das ferramentas que sua empresa usa: links, CRM, analytics, calendário. O custo de infraestrutura de um produto como o Link para um usuário intenso — 100.000 cliques por mês — fica abaixo de US$ 1/mês. Fizemos essa conta em detalhe em outro post, e a conclusão é sempre a mesma: a infra deixou de ser o custo há anos.

## Então, o que o SaaS cobra?

As margens também são públicas: os relatórios financeiros das empresas de SaaS mostram margens brutas na faixa de 70-80%. Ou seja, de cada US$ 100 que você paga de assinatura, entre US$ 70 e US$ 80 não são infraestrutura nem serviço: são margem. Marketing, vendas, escritórios, crescimento.

Olhando produto a produto:

- O encurtador de links cobra US$ 35/mês por algo que custa menos de US$ 1 para servir.
- O CRM cobra ~US$ 50 por usuário para guardar contatos numa tabela.
- O gestor de projetos cobra ~US$ 30 por usuário para mover cartões entre colunas.

Markups de 10x a 50x sobre o custo real de servir o produto. Não é ilegal nem secreto. É simplesmente desconfortável de olhar de perto — e é por isso que quase ninguém olha.

## Por que publicamos nossa fórmula

A Zerosoftware funciona ao contrário. O software é open source e grátis: baixe e rode onde quiser. E se você escolhe o cloud, paga a nuvem ao custo. A fórmula é pública e entediante:

> Preço = infraestrutura real alocada + impostos e taxas de pagamento. Margem: US$ 0.

Publicamos primeiro para nos proteger de nós mesmos. Se um dia alguém nesta empresa quiser inflar um preço, vai ter que explicar publicamente por que está se desviando da fórmula. Transparência não é um valor de marca: é um mecanismo de controle.

E protege você. Você pode auditar o preço contra a tabela pública da nuvem, do mesmo jeito que audita o código. E se algum número não fechar, o self-host espera com o mesmo software, o mesmo código e seu banco de dados num único arquivo.

Os preços da nuvem sempre foram públicos. A única coisa que faltava era alguém disposto a somá-los em voz alta.
