---
title: "Quanto custa de verdade rodar um encurtador de links (spoiler: centavos)"
description: "O Bitly cobra US$ 35 por mês. Nós fizemos a conta completa do custo de servir redirects e analytics. Os números, sem corar."
date: "2026-07-09"
author: "Zerosoftware"
tags: ["link", "custos", "nuvem"]
---

O Bitly cobra US$ 35 por mês pelo plano básico pago. Vejamos o que exatamente esses US$ 35 compram: redirects (301/302), um contador de cliques, alguns gráficos, QR codes.

Agora façamos a conta do que isso realmente custa para servir. Com números reais, da arquitetura real do Link, nosso encurtador.

## O que é um redirect, tecnicamente

Uma requisição chega a `seudominio/launch`. O servidor faz um `SELECT` num banco de dados, grava um `INSERT` com o clique e devolve uma resposta de ~300 bytes com um header `Location`.

Isso é tudo. É provavelmente a workload mais leve que existe na web. Não há vídeo, não há imagens, não há computação. É ler uma linha e responder.

## A conta, sem truques

Suponha um usuário intenso: 50 links ativos, 100.000 cliques por mês.

- **Computação.** 100.000 requisições mensais são ~2,3 requisições por minuto. Um VPS de US$ 5/mês (1 vCPU, 1GB RAM) aguenta centenas de requisições por *segundo* para isso. Você está usando menos de 2% da máquina. Custo real alocado: **US$ 0,10/mês**.
- **Banco de dados.** SQLite no mesmo VPS. 100.000 cliques são 100.000 linhas pequenas: ~20MB por mês. Num ano, 240MB. O disco de 25GB do VPS cobre uma década. Custo: **US$ 0**.
- **Banda.** 300 bytes por redirect mais a página de analytics que você olha. Menos de 100MB por mês. O VPS inclui 1TB. Custo: **US$ 0**.
- **Backups.** Snapshot semanal: ~US$ 0,50/mês.

**Total: menos de US$ 1 por mês.** E se você tiver 10.000 cliques em vez de 100.000, menos de US$ 0,20.

## Então, o que são os US$ 35?

Não são infraestrutura. São:

- O domínio curto bonito (que você também pode ter: custa US$ 10/ano).
- A equipe de vendas.
- A margem de 3.400%.

Quando o preço de algo é 35 vezes o seu custo, você não está comprando tecnologia. Está comprando a ausência de alternativa. Até que haja alternativa.

## Nosso compromisso

Com o Link, o software é grátis e open source: baixe e rode naquele VPS de US$ 5, seu para sempre. E se você quiser que rodemos para você, com login, backups e uptime, paga o que a nuvem custa. Ao custo. Com essa mesma conta aberta.

Os bits são grátis. Agora os preços também começam a ser.
