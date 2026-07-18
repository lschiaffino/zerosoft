---
title: "Por que você paga US$ 30 para mover cartões"
description: "Um gestor de projetos é um banco de dados, um drag-and-drop e um login. Desmontamos o preço do SaaS, peça por peça."
date: "2026-07-03"
author: "Zerosoftware"
tags: ["saas", "preços", "track"]
---

Abra o seu gestor de projetos. O que você vê? Cartões se movendo entre colunas. Um campo de texto com formatação. Responsáveis, datas, etiquetas. Notificações.

Agora pergunte-se: qual parte disso custa US$ 30 por usuário por mês?

## A anatomia de um kanban

Tecnicamente, um gestor de projetos moderno é:

1. **Um banco de dados.** Postgres ou similar. Guarda tabelas: projetos, tarefas, usuários, comentários. Custo por usuário ativo: centavos.
2. **Um frontend com drag-and-drop.** React, uma biblioteca de DnD, websockets para sincronizar. Escrito uma vez, serve milhões.
3. **Um login.** OAuth com Google. Resolvido, grátis, há uma década.
4. **Um servidor.** Um VPS de US$ 20 roda isso para centenas de empresas pequenas.

O custo marginal de adicionar mais um usuário é, literalmente, zero. Não há fábrica, não há estoque, não há frete. É um `INSERT` numa tabela.

## Então, o que você está pagando?

Você não paga tecnologia. Você paga:

- **O hábito.** "Sempre custou isso" não é argumento — é herança.
- **O lock-in.** Seus projetos, seu histórico, seus fluxos estão dentro. Migrar custa mais que continuar pagando. O preço não reflete o valor do software: reflete o custo de sair.
- **O posicionamento.** Quando o primeiro cobrou US$ 8/usuário e funcionou, todos copiaram. Não é preço de mercado: é um cartel de fato.
- **O marketing.** Uma parte enorme da sua assinatura paga os anúncios que trouxeram você e o próximo cliente. Você paga para ser vendido.

## O teste definitivo

Há uma forma simples de saber se um preço é honesto: quanto custa rodar você mesmo?

Um gestor de projetos open source num VPS de US$ 5/mês serve uma equipe inteira. Sem limite de usuários. Com seus dados no seu servidor. A diferença entre US$ 5 e US$ 30×10 usuários não é engenharia: é margem.

## Por isso existe o Track

Track é o nosso gestor de projetos. Open source, rápido, keyboard-first, com cycles e roadmaps. Se você hospedar, custa US$ 0. Se rodarmos para você, você paga a nuvem ao custo: alguns dólares por equipe, não por usuário.

Não é mais barato porque vale menos. É mais barato porque cobramos o que custa.

O software morreu. E o preço dele também.
