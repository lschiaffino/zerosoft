---
title: "O software livre já roda a infraestrutura. Falta a camada do usuário."
description: "Linux, Postgres, nginx e Kubernetes já são open source. As ferramentas que as pessoas usam no trabalho continuam proprietárias, e é essa camada que a zerosoft reconstrói."
date: "2026-05-28"
author: "zerosoft"
tags: ["open source", "linux", "saas"]
---

Se você está lendo isto, sua requisição quase certamente passou por um servidor Linux, um proxy como o nginx e um banco de dados open source. A infraestrutura da internet roda sobre software livre há anos, e isso deixou de ser notícia.

Alguns números verificáveis:

- Os 500 supercomputadores mais potentes do mundo (lista TOP500) rodam Linux desde 2017.
- O relatório anual de auditorias de código da Synopsys (OSSRA) encontra componentes open source em mais de 90% das bases de código comerciais analisadas.
- Postgres, MySQL, Redis, nginx, Kubernetes, Docker e Git, o stack com que se constrói a internet, são open source.

No servidor, o software livre já ganhou.

## A camada que ficou de fora

A exceção é a camada que as pessoas usam no trabalho: o encurtador de links, o CRM, o calendário, o gestor de projetos, o chat com clientes. Ela continua proprietária e cobrada por mês.

Esses produtos rodam em Linux, guardam dados em Postgres e servem tráfego com nginx, mas são vendidos como caixas-pretas. O SaaS moderno é open source por baixo e aluguel por cima.

O resultado aparece no orçamento: a infraestrutura, que é a parte tecnicamente difícil, é aberta. As ferramentas de escritório, tecnicamente mais simples, custam dezenas de dólares por usuário por mês.

Há uma explicação. A infraestrutura foi aberta porque engenheiros a construíam para si mesmos, e compartilhar dava vantagem. A camada de aplicação ficou fechada porque era ali que estava o modelo de negócio: o usuário final não audita código, paga assinatura.

## O que estamos construindo

A zerosoft reconstrói essa camada como open source. Hoje são onze apps: CRM, Chat, Agents, Flow, Robots, Track, Link, Docs, Notes, Cal e Board, num mesmo workspace e com um só login.

Todas seguem o mesmo contrato: hospedar por conta própria custa $0 (AGPLv3), e no zerosoft Cloud você começa num plano grátis e depois paga pelo uso do workspace.

A infraestrutura já é aberta. Falta a parte que roda na aba do seu navegador.
