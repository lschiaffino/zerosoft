---
title: "US$ 30 por usuário para mover cartões: de onde vem esse preço"
description: "Um gestor de projetos é um banco de dados, um quadro com arrastar e soltar e um login. Desmontamos o preço peça por peça."
date: "2026-07-03"
author: "zerosoft"
tags: ["saas", "preços", "track"]
---

Abra o seu gestor de projetos. Você vê cartões indo de uma coluna para outra, um campo de texto com formatação, responsáveis, datas, etiquetas e notificações. A pergunta deste post: qual parte disso custa US$ 30 por usuário por mês?

## Do que é feito um kanban

Tecnicamente, um gestor de projetos moderno tem quatro peças:

1. **Um banco de dados.** Tabelas de projetos, tarefas, usuários e comentários. Custo por usuário ativo: centavos.
2. **Um frontend com arrastar e soltar.** Escrito uma vez, serve milhões de pessoas.
3. **Um login.** OAuth com Google, um problema resolvido há mais de uma década.
4. **Um servidor.** Um VPS de US$ 20 atende centenas de times pequenos.

Adicionar um usuário é um `INSERT` numa tabela. Não tem estoque nem frete.

## O que entra no preço

- **O hábito.** "Sempre custou isso" é herança, não cálculo.
- **O lock-in.** Seus projetos, histórico e fluxos estão lá dentro, e migrar dá trabalho. O preço reflete o custo de sair.
- **O preço de referência.** Quando o primeiro cobrou por usuário e funcionou, os outros copiaram.
- **O marketing.** Uma parte da assinatura paga os anúncios que trouxeram você e vão trazer o próximo cliente.

## Um teste simples

Quanto custa rodar por conta própria? Um gestor de projetos open source num VPS de US$ 5 por mês atende um time inteiro, sem limite de usuários, com os dados no seu servidor. A diferença entre US$ 5 e US$ 300 por mês (10 usuários a US$ 30) é margem.

## Track

Track é o gestor de projetos da zerosoft: issues com sub-issues e relações, ciclos, estimativas, status próprios por projeto e quatro visões (lista, quadro, calendário e Gantt). O código é aberto e hospedar custa $0. No zerosoft Cloud você começa num plano grátis e paga pelo uso do workspace, sem cobrança por assento.

O que ainda falta (API pública e atalhos de teclado no nível do Linear) está listado em [Track vs Linear](/blog/zerosoft-track-vs-linear).
