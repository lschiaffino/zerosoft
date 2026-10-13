---
title: "Clonar um SaaS em uma semana: como construímos o Link"
description: "Um engenheiro com uma LLM construiu o Link em dias. O que isso muda no custo de fazer software e no preço que faz sentido cobrar."
date: "2026-05-30"
author: "zerosoft"
tags: ["ia", "open source", "saas", "link"]
---

Dois anos atrás, clonar o Bitly era um projeto de seis meses: uma equipe de três ou quatro pessoas, roadmap, sprints, QA e um orçamento de seis dígitos. Hoje, um engenheiro com uma LLM faz isso em uma semana. Não é previsão. É exatamente como construímos o Link.

## O que "uma semana" significa

Quando dizemos que o Link foi construído em dias, estamos falando de tudo isso:

- Um redirect engine que resolve um alias customizado e devolve o destino em milissegundos.
- Um dashboard com analytics por dia, referrer, país, device, browser e OS: sem cookies.
- QR em SVG e PNG, links com senha, expiração, limite de cliques, tags e UTM builder.
- Uma API pública v1 com API keys via Bearer.
- Login apenas com Google. Sem formulário de cadastro, sem senha para guardar.

Cada uma dessas peças era, em 2019, um ticket de duas semanas. Hoje é uma tarde.

## O que mudou de verdade

Não é que a IA "programe sozinha". É que boa parte do trabalho de um SaaS padrão é código que já foi escrito mil vezes: endpoints CRUD, migrations, validações, testes, esquema de API keys, rate limiter. Esse código não precisa de gênio; precisa de tempo. E as LLMs reduziram esse tempo de semanas para minutos.

O engenheiro sênior não desapareceu: mudou de papel. Parou de digitar boilerplate e passou a fazer o que sempre foi seu trabalho de verdade: decidir a arquitetura, revisar, cortar features e manter a coerência do sistema. A IA escreve rápido; alguém precisa saber o que pedir e o que rejeitar.

O resultado é uma assimetria brutal: o custo de *criar* um SaaS típico caiu uma ou duas ordens de grandeza. E o custo de *rodá-lo* já era público: uma VPS, um banco de dados, banda medida em centavos.

## A consequência que ninguém quer dizer em voz alta

Se construir um encurtador de links custa uma semana de uma pessoa, cobrar US$ 12 por mês para usá-lo é um aluguel cobrado pelo hábito.

Os preços do SaaS se sustentavam com um argumento razoável: construir software era caro, e alguém tinha que pagar esses salários. Esse argumento perdeu força. Quando o custo de produção cai, o preço acompanha: aconteceu com a música, com o armazenamento e com as ligações internacionais. O software não é especial.

Nós simplesmente deixamos isso explícito:

1. **Self-host, $0.** O código é open source. Baixe, audite, hospede.
2. **zerosoft Cloud pelo uso.** Se você não quer administrar nada, a gente roda. Você começa num plano grátis e depois paga pelo uso do workspace, sem cobrança por assento.

Clonar um SaaS em uma semana muda a conta do preço: os bits custam quase nada, e o que sobra é o custo de rodar.
