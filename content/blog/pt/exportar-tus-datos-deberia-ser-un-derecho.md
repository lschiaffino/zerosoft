---
title: "Exportar seus dados deveria ser um direito"
description: "Antes de assinar um SaaS, pergunte como você sai. O que cada app da zerosoft exporta hoje (CSV, JSON e API), o que ainda falta e um teste para conferir."
date: "2026-06-15"
author: "zerosoft"
tags: ["export", "lock-in", "open source", "link"]
---

Antes de assinar um SaaS, pergunte: como eu saio? O botão de export existe em quase todo lugar. A pergunta é o que sai por ele e em que estado. Na maioria das vezes, sai menos do que você imagina, num formato pior do que você precisa.

Para nós, exportar os seus dados é um direito, e o software deveria nascer com ele.

## O teste dos dez minutos

O teste: você consegue ir embora em dez minutos? Cancelar a assinatura é sempre fácil. O teste é levar tudo, num formato aberto, sem falar com ninguém, e reconstruir a sua operação em outro lugar no mesmo dia.

O teste tem quatro partes:

- **Completo**: tudo o que entrou e tudo o que foi gerado no caminho. Se você exporta os links mas não as estatísticas de cliques, o export está incompleto.
- **Aberto**: JSON, CSV, formatos que existem há décadas e que qualquer ferramenta lê. Um arquivo proprietário é um cofre com o seu nome e a chave dos outros.
- **Sem intermediários**: nenhum ticket de suporte, nenhum "fale com o seu account manager", nenhuma espera de 48 horas. Um botão e uma API.
- **Verificável**: dá para testar no dia um, com dados de teste, antes de migrar qualquer coisa. Se um produto não passa no teste com dados falsos, não vai passar com os seus.

## Como o Link exporta hoje

O Link, nosso encurtador, passa no teste inteiro:

- Pelo dashboard você exporta todos os seus links (alias, destino, senha, expiração, máximo de cliques, tags, UTM) em JSON ou CSV, com um clique.
- As analytics vão junto: cada clique registrado, com data, referrer, país, device, browser e OS. Linhas cruas, não só os agregados bonitos do painel.
- A API v1 expõe tudo isso por HTTP, com a sua API key. Um script de vinte linhas baixa a sua conta inteira. Sem pedir permissão.
- E se você roda self-hosted, o export mais brutal de todos: o seu banco de dados é um arquivo SQLite. Você copia e pronto. Isso é portabilidade.

## O que acontece lá fora

O mercado, enquanto isso:

- **Slack**: no plano gratuito, o export cobre só os canais públicos. As suas mensagens diretas e os canais privados não saem pela porta comum.
- **Notion**: exporta, sim. Os bancos de dados saem como CSV planos: as relações entre tabelas, os rollups, a estrutura que dava sentido à sua informação, isso não viaja. Você leva as linhas; o modelo fica.
- E ainda tem a tática mais honesta de todas: a das ferramentas que simplesmente não têm export e te mandam para o suporte, onde um humano decide quando (e se) você recupera os seus dados.

Nada disso é acidente. Um export completo é um cliente que pode ir embora.

## Onde a zerosoft está hoje

A regra que seguimos é export completo em formatos abertos. Nem todas as apps chegaram lá, e preferimos dizer qual está onde:

- **Link:** links em CSV ou JSON, cliques em CSV por link, e tudo pela API pública.
- **CRM:** contatos, empresas e negócios em CSV ou JSON, e a API v1 para o resto (atividades, cotações, formulários).
- **Cal:** tipos de evento e reservas pela API v1.
- **Docs:** ainda não tem export. Hoje dá para copiar o conteúdo de uma página ou ler as páginas pela API interna.
- **Track:** ainda não tem API pública nem export.

Em self-host, todos os dados de todas as apps ficam num único arquivo SQLite que é seu. E o código é open source: se um dia fizermos as coisas mal, você precisa de um VPS de $5 e uma tarde para seguir sem a gente.
