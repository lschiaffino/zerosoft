---
title: "Exportar seus dados deveria ser um direito"
description: "Portabilidade não é feature premium: é um direito. Todo produto da Zerosoftware nasce com export completo em JSON, CSV e API. Aqui está o teste para comprovar."
date: "2026-06-15"
author: "Zerosoftware"
tags: ["export", "lock-in", "open source", "link"]
---

Tem uma pergunta que quase ninguém faz antes de assinar um SaaS: como eu saio? Não se dá para sair — o botão de export existe em quase todo lugar — mas o que sai por aquela porta e em que estado. Na maioria das vezes a resposta é: menos do que você imagina, num formato pior do que você precisa.

A gente parte do lado oposto: exportar os seus dados não é uma gentileza do fornecedor. É um direito, e o software deveria nascer com ele.

## O teste dos dez minutos

O teste é simples: você consegue ir embora em dez minutos? Não cancelar a assinatura — isso é sempre fácil, porque convém a eles — mas levar tudo, num formato aberto, sem falar com ninguém, e reconstruir a sua operação em outro lugar no mesmo dia.

O teste tem quatro partes:

- **Completo**: tudo o que entrou e tudo o que foi gerado no caminho. Se você exporta os links mas não as estatísticas de cliques, não é um export: é uma lembrancinha.
- **Aberto**: JSON, CSV, formatos que existem há décadas e que qualquer ferramenta lê. Um arquivo proprietário é um cofre com o seu nome e a chave dos outros.
- **Sem intermediários**: nenhum ticket de suporte, nenhum "fale com o seu account manager", nenhuma espera de 48 horas. Um botão e uma API.
- **Verificável**: dá para testar no dia um, com dados de teste, antes de migrar qualquer coisa. Se um produto não passa no teste com dados falsos, não vai passar com os seus.

## Como o Link exporta hoje

O Link, nosso encurtador, passa no teste inteiro:

- Pelo dashboard você exporta todos os seus links — alias, destino, senha, expiração, máximo de cliques, tags, UTM — em JSON ou CSV, com um clique.
- As analytics vão junto: cada clique registrado, com data, referrer, país, device, browser e OS. Linhas cruas, não só os agregados bonitos do painel.
- A API v1 expõe tudo isso por HTTP, com a sua API key. Um script de vinte linhas baixa a sua conta inteira. Sem pedir permissão.
- E se você roda self-hosted, o export mais brutal de todos: o seu banco de dados é um arquivo SQLite. Você copia e pronto. Isso é portabilidade.

## O que acontece lá fora

O mercado, enquanto isso:

- **Slack**: no plano gratuito, o export cobre só os canais públicos. As suas mensagens diretas e os canais privados não saem pela porta comum.
- **Notion**: exporta, sim. Os bancos de dados saem como CSV planos: as relações entre tabelas, os rollups, a estrutura que dava sentido à sua informação — isso não viaja. Você leva as linhas; o modelo fica.
- E ainda tem a tática mais honesta de todas: a das ferramentas que simplesmente não têm export e te mandam para o suporte, onde um humano decide quando — e se — você recupera os seus dados.

Nada disso é acidente. Um export completo é um cliente que pode ir embora.

## Nossa regra: o export nasce com o produto

Na Zerosoftware a regra é uma só e não se negocia: nenhum produto sai sem export completo desde o dia um. JSON e CSV pela interface, API pública documentada, formatos abertos. O Link já faz isso. O CRM, o Cal e o Track — todos coming soon — vão abrir com a mesma garantia no dia em que forem lançados.

E o código é open source: se um dia fizermos as coisas mal, você não vai precisar do export — vai precisar de um VPS de $5 e uma tarde.

Os seus dados são seus. O software que não entende isso está avisando, com antecedência, exatamente quanto vai custar sair.
