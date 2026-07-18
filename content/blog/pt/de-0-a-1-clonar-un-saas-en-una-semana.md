---
title: "Do 0 ao 1: clonar um SaaS em uma semana"
description: "O que antes levava uma equipe e seis meses, hoje leva dias. O Link foi construído exatamente assim. Quando o custo de criar software colapsa, o preço precisa acompanhar."
date: "2026-05-30"
author: "Zerosoftware"
tags: ["ia", "open source", "saas", "link"]
---

Dois anos atrás, clonar o Bitly era um projeto de seis meses: uma equipe de três ou quatro pessoas, roadmap, sprints, QA e um orçamento de seis dígitos. Hoje, um engenheiro com uma LLM faz isso em uma semana. Não é previsão. É exatamente como construímos o Link.

## O que "uma semana" significa

Quando dizemos que o Link foi construído em dias, estamos falando de tudo isso:

- Um redirect engine que resolve um alias customizado e devolve o destino em milissegundos.
- Um dashboard com analytics por dia, referrer, país, device, browser e OS — sem cookies.
- QR em SVG e PNG, links com senha, expiração, limite de cliques, tags e UTM builder.
- Uma API pública v1 com API keys via Bearer.
- Login apenas com Google. Sem formulário de cadastro, sem senha para guardar.

Cada uma dessas peças era, em 2019, um ticket de duas semanas. Hoje é uma tarde.

## O que mudou de verdade

Não é que a IA "programe sozinha". É que 80% do trabalho de um SaaS padrão é código que já foi escrito mil vezes: endpoints CRUD, migrations, validações, testes, esquema de API keys, rate limiter. Esse código não precisa de gênio; precisa de tempo. E as LLMs reduziram esse tempo de semanas para minutos.

O engenheiro sênior não desapareceu: mudou de papel. Parou de digitar boilerplate e passou a fazer o que sempre foi seu trabalho de verdade — decidir a arquitetura, revisar, cortar features, manter a coerência do sistema. A IA escreve rápido; alguém precisa saber o que pedir e o que rejeitar.

O resultado é uma assimetria brutal: o custo de *criar* um SaaS típico caiu uma ou duas ordens de grandeza. E o custo de *rodá-lo* já era público: uma VPS, um banco de dados, banda medida em centavos.

## A consequência que ninguém quer dizer em voz alta

Se construir um encurtador de links custa uma semana de uma pessoa, cobrar US$ 12 por mês para usá-lo não é um negócio: é um aluguel cobrado pelo hábito.

Os preços do SaaS se sustentavam com um argumento razoável: construir software era caro, e alguém tinha que pagar esses salários. Esse argumento morreu. Quando o custo de produção colapsa, o preço acompanha — aconteceu com a música, com o armazenamento, com as ligações internacionais. O software não é especial.

Nós simplesmente deixamos isso explícito:

1. **Self-host, $0.** O código do Link é open source. Baixe, audite, hospede. É seu.
2. **Cloud a custo.** Se você não quer administrar nada, rodamos para você e você paga exatamente o que a nuvem custa. Sem margem, nem um centavo a mais.

A semana que leva para clonar um SaaS não é uma anedota de produtividade. É o novo preço do software: zero pelos bits, mais o custo dos servidores. E esse valor está publicado.
