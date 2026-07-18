---
title: "A Bitly cobra US$ 35. Os bits são de graça."
description: "Detalhamos o plano pago da Bitly item por item e comparamos com o custo real de servir redirects. A diferença não é engenharia: é margem."
date: "2026-06-26"
author: "Zerosoftware"
tags: ["bitly", "link", "preços"]
---

Abra a página de preços da Bitly. O plano Core: US$ 35 por mês, cobrado anualmente. O que você compra exatamente com isso? Passamos item por item, com a calculadora na mão. Spoiler: a tecnologia dessa lista custa menos que o cafezinho que você está tomando.

## O que os US$ 35 compram, detalhado

- **Cerca de 1.500 links com sua marca por mês.** Um link é uma linha numa tabela: slug, URL de destino, data, flags. ~100 bytes. As 1.500 linhas do mês dão 150KB — menos que uma foto do seu celular. Custo marginal: US$ 0.
- **Redirects ilimitados.** Cada clique é um `SELECT`, um `INSERT` e uma resposta 302 de ~300 bytes. É a workload mais leve que existe na web. Um milhão de redirects por mês move menos de 1GB de tráfego. Centavos, sendo generosos.
- **QR codes.** Um SVG ou PNG gerado na hora a partir da string do link. Não há computação nem armazenamento que valha mencionar. Custo: US$ 0.
- **Analytics de cliques.** Contagem por dia, referrer, país, dispositivo. Cada clique é uma linha de ~200 bytes. Cem mil cliques por mês durante um ano: 240MB de disco. Um VPS de US$ 5 vem com 25GB.
- **Um domínio próprio.** Detalhe: quem registra é você, no registrador, por uns US$ 10 por ano. A Bitly não paga um centavo disso.
- **UTM builder.** Um formulário que concatena strings com `?utm_source=...`. Literalmente isso.

## A conta que não fecha

Infraestrutura total para um usuário intenso: menos de US$ 1 por mês. Já fizemos essa conta completa, linha por linha, em outro post.

US$ 35 dividido por US$ 1 é uma margem de 3.400%. Não é preço de tecnologia; é o preço da falta de alternativa. Os US$ 34 restantes pagam o time de vendas, os anúncios que te levaram até lá e um costume de vinte anos de que "link com marca se paga".

> Quando algo custa 35 vezes o seu custo, você não está comprando tecnologia. Está comprando costume.

## A alternativa já existe

**Link** é o nosso encurtador: aliases customizados, analytics por dia, referrer, país, dispositivo, navegador e SO — sem cookies —, QR em SVG e PNG, links com senha, expiração, limite de cliques, tags, UTM builder e uma API pública com API keys. Tudo do checklist da Bitly, e mais.

O código é aberto: baixe e rode no seu VPS. Self-hosted custa US$ 0, para sempre. E se preferir que a gente rode por você — com login, backups e uptime — você paga o que a nuvem custa. A custo. Sem margem.

A Bitly cobra US$ 35. Os bits são de graça. Agora os links também são.
