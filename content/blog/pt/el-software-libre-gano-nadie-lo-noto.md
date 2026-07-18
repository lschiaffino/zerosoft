---
title: "O software livre venceu. Ninguém percebeu."
description: "Linux, Postgres, nginx, Kubernetes: o mundo já roda sobre open source. A única camada que continuou proprietária é a que toca o usuário. Essa última milha é o que viemos fechar."
date: "2026-05-28"
author: "Zerosoftware"
tags: ["open source", "linux", "saas"]
---

Se você está lendo isto, sua requisição passou por um servidor Linux, atravessou um nginx, consultou um Postgres e provavelmente saiu de um container orquestrado pelo Kubernetes. O mundo já roda sobre software livre. Faz tempo. Tanto tempo que deixou de ser notícia.

Os números são de uma contundência que entedia:

- Mais de 80% dos servidores web — e praticamente 100% dos 500 supercomputadores mais potentes do mundo — rodam Linux.
- Mais de 90% da infraestrutura de cloud se apoia em software open source.
- Postgres, MySQL, Redis, nginx, Kubernetes, Docker, Git: o stack completo com que se constrói a internet é livre.
- As auditorias de código da Synopsys vêm reportando há anos que mais de 90% das bases de código comerciais contêm componentes open source.

A batalha pelo servidor acabou. O software livre venceu de forma tão completa que ninguém comemora: é simplesmente o ar que a indústria respira.

## A camada que ficou de fora

Há uma exceção visível: a camada que toca o usuário. O encurtador de links, o CRM, o calendário, o gestor de projetos, o chat da equipe. Essa última milha continuou proprietária, fechada e com assinatura mensal.

A ironia é difícil de ignorar: esses produtos são construídos inteiramente sobre software livre — rodam em Linux, guardam dados em Postgres, servem tráfego com nginx — mas são vendidos como caixas-pretas. O SaaS moderno é open source por baixo e aluguel por cima.

O resultado salta à vista em qualquer orçamento de TI: a infraestrutura, que é a parte tecnicamente difícil, é grátis. As ferramentas de escritório, que são a parte tecnicamente simples, custam dezenas de dólares por usuário por mês. O mapa de preços do software ficou exatamente ao contrário.

Não é um acidente técnico. A infraestrutura foi liberada porque os engenheiros a construíam para si mesmos, e compartilhar era vantagem competitiva. A camada de aplicação ficou capturada porque era ali que morava o modelo de negócio: o usuário final não audita código, paga assinatura.

## A última milha

É isso que viemos fechar. As ferramentas de trabalho — as que usa todos os dias quem não programa — são a última milha do software livre.

Começamos pelo **Link**: short links com alias customizado, analytics sem cookies, QR em SVG e PNG, links com senha e expiração, e uma API pública v1. Já está disponível, o código é aberto e a cloud é cobrada a custo. Depois vêm Track (Q4 2026), CRM (Q1 2027) e Cal (Q2 2027), com o mesmo contrato: self-host a $0 ou cloud a custo, sem margem.

O software livre não precisa ser descoberto. Precisa ser terminado. A infraestrutura já é livre; falta liberar o que toca as pessoas.

> A última milha do open source não roda num datacenter. Roda na sua aba do navegador.
