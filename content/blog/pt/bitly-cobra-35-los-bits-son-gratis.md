---
title: "O que os US$ 35 do Bitly compram, item por item"
description: "Desmontamos o plano Core do Bitly e comparamos cada item com o custo de servir redirects. A diferença está na margem."
date: "2026-06-26"
author: "zerosoft"
tags: ["bitly", "link", "preços"]
---

O plano Core do Bitly custa US$ 35 por mês, com cobrança anual. Passamos pela lista do que ele inclui e estimamos quanto custa servir cada item.

## O que os US$ 35 compram

- **Cerca de 1.500 links com a sua marca por mês.** Um link é uma linha numa tabela (slug, destino, data, flags), uns 100 bytes. As 1.500 linhas do mês somam 150 KB.
- **Redirects ilimitados.** Cada clique é um `SELECT`, um `INSERT` e uma resposta 302 de uns 300 bytes. Um milhão de redirects por mês move menos de 1 GB de tráfego.
- **QR codes.** Um SVG ou PNG gerado na hora a partir do link. Quase nada de processamento e nada de armazenamento.
- **Analytics de cliques.** Contagem por dia, referrer, país e dispositivo. Cada clique é uma linha de uns 200 bytes: cem mil cliques por mês durante um ano ocupam 240 MB. Um VPS de US$ 5 vem com 25 GB.
- **Um domínio próprio.** Quem registra é você, no registrador, por uns US$ 10 por ano.
- **UTM builder.** Um formulário que adiciona `?utm_source=...` a uma URL.

## A conta

A infraestrutura para um usuário intenso fica abaixo de US$ 1 por mês. A conta completa, linha por linha, está em [quanto custa rodar um encurtador](/blog/cuanto-cuesta-correr-un-link-shortener).

O resto dos US$ 35 paga vendas, anúncios e o costume de que link com marca é produto premium.

## O Link

Link é o encurtador da zerosoft: alias próprio, domínios próprios, analytics sem cookies (por dia, referrer, país, dispositivo, navegador e sistema), QR em SVG e PNG, links com senha, expiração e limite de cliques, tags, UTM builder, importação do Bitly e uma API pública com webhooks.

O código é aberto e hospedar no seu VPS custa $0. No zerosoft Cloud você começa num plano grátis e depois paga pelos cliques que usar. A comparação completa, incluindo o que o Bitly faz melhor, está em [Link vs Bitly](/blog/zerosoft-link-vs-bitly).
