---
title: "Analytics sem cookies: o que um clique já conta"
description: "Os analytics do Link funcionam sem cookies e sem fingerprinting. Tudo o que registramos de um clique vem da requisição HTTP que o navegador já envia."
date: "2026-06-24"
author: "zerosoft"
tags: ["analytics", "privacidade", "link", "open source"]
---

Um clique num link curto é uma requisição HTTP: o navegador pede o redirect e o servidor responde com um 302. Os analytics do Link leem o que já vem nessa requisição (país, referrer, dispositivo, navegador) e não colocam nada no navegador de quem clicou.

## A requisição conta a história

Quando alguém clica em um dos seus links curtos, o navegador envia uma requisição HTTP. Três partes dela carregam tudo o que reportamos:

- **O header Referer.** Diz de onde veio o clique: `x.com`, `news.ycombinator.com`, o domínio da sua newsletter. Os navegadores modernos cortam o valor para a origem por padrão, então vemos o site, não a página exata. Tudo bem: o site é a resposta útil.
- **O header User-Agent.** A string com que o navegador se apresenta. Fazemos o parse localmente em três campos: tipo de dispositivo (mobile, tablet, desktop), família do navegador e família do SO. A string crua nunca toca o banco de dados.
- **O IP da conexão.** Usado para uma coisa só: uma consulta de país numa base GeoIP embutida no app. A consulta roda em memória, no nosso servidor, sem chamadas externas, e depois é descartado. Guardamos o código do país, não o endereço.

Nada de JavaScript na página de destino. Nada de pixel. Nada de localStorage. O clique é medido no redirect, que é o único momento em que o navegador precisa falar com a gente de qualquer forma.

## O que guardamos, o que não

Cada clique vira uma linha de uns 200 bytes:

- Timestamp
- ID do link
- Host do referrer
- Código do país
- Tipo de dispositivo, família do navegador, família do SO

E esta é a lista que importa mais: o que não guardamos.

- **Nada de IPs.** Usados em memória, descartados, nunca escritos em disco.
- **Nada de cookies.** Não criamos nenhum, em nenhum domínio.
- **Nada de fingerprinting.** Nada de truques com canvas, lista de fontes ou tamanho de tela.
- **Nada de IDs de usuário, sessões ou identidade entre cliques.** Não conseguimos saber se uma pessoa clicou dez vezes ou dez pessoas clicaram uma. Nem queremos.

O dashboard e o `GET /api/v1/links/:id/stats` mostram cliques por dia, referrer, país, dispositivo, navegador e SO. Esse é o dataset inteiro. É agregado por construção, não por política.

## Por que não tem banner de consentimento

Banners de cookie existem por causa de duas regras. As normas de ePrivacy exigem consentimento antes de guardar ou ler informação no dispositivo de alguém: são os cookies e seus primos. O GDPR entra em cena quando você processa dados pessoais, e um IP amarrado a um histórico de navegação se qualifica.

Nós não fazemos nenhum dos dois. Nada é guardado no dispositivo do visitante e nada do que guardamos pode identificar uma pessoa. Não há o que consentir, então não há banner, e nenhum pedaço da sua audiência se perde no "rejeitar tudo". Se o seu jurídico quiser conferir, o schema é open source: eles leem mais rápido do que marcam uma reunião.

## Comparado com os analytics tradicionais

O analytics web clássico carrega um script de terceiros, cria cookies, segue usuários entre sessões e às vezes entre sites, e depois manda tudo para servidores alheios. Responde perguntas como "quem é essa pessoa e do que mais ela gosta", perguntas que um encurtador de links não tem por que fazer.

Para um redirect, aliás, a abordagem server-side é simplesmente mais precisa: um ad blocker pode matar um script de tracking, mas não pode segurar um 302. Todo clique é contado, porque a contagem acontece onde o redirect acontece.

As estatísticas dos seus links são suas: visíveis no dashboard, exportáveis pela API e idênticas no self-host. Mesmo código, mesmo schema, seu SQLite. Analytics que medem o seu tráfego sem vigiar a sua audiência.
