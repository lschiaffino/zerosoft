---
title: "Linear a US$ 8 por usuário: por que construímos o Track"
description: "O Linear é provavelmente o melhor gestor de issues que existe. O que gostamos nele, quanto custa para um time e por que construímos o Track como alternativa open source."
date: "2026-06-21"
author: "zerosoft"
tags: ["track", "linear", "open source"]
---

O Linear é provavelmente o melhor gestor de issues já construído. Este post diz o que copiamos dele, quanto ele custa para um time e por que construímos o Track.

## O que gostamos no Linear

- **A velocidade.** As mudanças aparecem na hora e quase não existe spinner. É isso que faz o time querer atualizar o quadro.
- **O teclado.** `Cmd+K` e você cria, atribui, move e fecha sem tocar no mouse.
- **Os ciclos.** Sprints sem cerimônia: o trabalho entra, é priorizado, é feito e é medido.

O Linear provou que um issue tracker pode ser tão agradável quanto um bom editor de texto. Isso é difícil de fazer.

## A fatura

O plano Standard custa US$ 8 por usuário por mês. A conta para alguns tamanhos de time:

- 10 pessoas: US$ 960 por ano.
- 50 pessoas: US$ 4.800 por ano.
- 200 pessoas: US$ 19.200 por ano.

O que fica guardado são issues: título, descrição, status, prioridade e alguns timestamps. O custo de infraestrutura por pessoa é de centavos, e a fatura cresce com o time, junto com o custo de sair.

## O que o Track tem hoje

- Issues com status próprios por projeto, prioridades, labels, responsáveis e estimativas.
- Sub-issues e relações (bloqueia, duplica).
- Ciclos para planejar cada sprint.
- Quatro visões: lista, quadro, calendário e Gantt.
- Comentários, anexos, histórico de atividade e inbox.
- Self-host com um `docker compose up`, com os dados num arquivo SQLite seu.

O que ainda falta: API pública, importador do Linear e o nível de atalhos de teclado do Linear. A lista completa está em [Track vs Linear](/blog/zerosoft-track-vs-linear).

## Quanto custa

O código é aberto (AGPLv3) e hospedar para o time inteiro custa $0. No zerosoft Cloud você começa num plano grátis e depois paga pelo uso do workspace. Assentos não são cobrados.
