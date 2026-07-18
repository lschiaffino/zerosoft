---
title: "APIs abertas: por que documentamos tudo"
description: "A API v1 pública do Link está documentada por completo em /docs, endpoint por endpoint. Não é um detalhe: é a nossa garantia contra lock-in."
date: "2026-05-27"
author: "Zerosoftware"
tags: ["api", "open source", "link"]
---

Tem um jeito fácil de saber se um produto respeita você: olhe a API. Se a API existe, está documentada e permite fazer tudo o que a interface faz, o produto trata você como adulto. Se a API é um acessório esquecido — três endpoints escondidos, documentação desatualizada, "fale com vendas para ter acesso" — o produto trata você como refém.

Nós começamos pelo outro lado. O Link é API-first: a interface web é só mais um cliente da API pública. Tudo o que você faz com o mouse, você faz com curl.

## A API v1, completa

A API v1 do Link está disponível hoje, documentada endpoint por endpoint em /docs, sem seções de "coming soon" disfarçadas:

- **Criar links**: `POST /api/v1/links` com alias customizado, senha, data de expiração, máximo de cliques, tags e parâmetros UTM.
- **Listar e buscar**: `GET /api/v1/links` com filtros por tag e domínio.
- **Estatísticas**: `GET /api/v1/links/:id/stats` com cliques por dia, referrer, país, dispositivo, navegador e sistema operacional. Sem cookies, sem fingerprinting — os mesmos dados do dashboard.
- **QR codes**: geração em SVG e PNG.

A autenticação é uma API key no header `Authorization: Bearer`. Você gera e revoga as chaves na sua conta, sem abrir ticket de suporte. Os rate limits são públicos e vêm nos headers `X-RateLimit-*` de cada resposta: você sabe exatamente quantas requisições ainda tem antes de bater no teto. Os erros são JSON com códigos estáveis, não HTML de surpresa.

```bash
curl -X POST https://zerosoftware.ai/api/v1/links \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://suaempresa.com/lancamento", "alias": "lancamento"}'
```

## A garantia anti-lock-in que funciona de verdade

Todo mundo promete "sem lock-in". A maioria quer dizer "você pode exportar um CSV se achar o botão". Uma API aberta é uma promessa diferente — e verificável:

1. **Você pode automatizar a sua saída.** Um script de vinte linhas percorre seus links, baixa suas estatísticas e as reconstrói em outro lugar. Sem precisar da nossa cooperação.
2. **Você se integra sem pedir permissão.** Seu CRM, seu CI, sua newsletter. Se fala HTTP, fala com o Link.
3. **O plano B já existe.** O código é open source. Se desaparecermos amanhã, a sua automação aponta para o seu próprio servidor e continua igual. A API é a mesma porque o software é o mesmo.

Uma empresa que entrega uma API completa está entregando a porta de saída, acesa e destrancada. Nós a documentamos porque temos certeza de que você vai ficar pelo quanto funciona bem, não pelo quanto é difícil ir embora.

## O que vem a seguir

- **Webhooks**: eventos de clique em tempo real para o seu endpoint, para reagir no momento em que algo acontece.
- **Endpoints por produto**: Track (Q4 2026), CRM (Q1 2027) e Cal (Q2 2027) saem cada um com sua API pública desde o primeiro dia. A mesma regra: documentado primeiro, estável depois.

A interface é para as pessoas. A API é para a sua empresa. As duas precisam ser de primeira classe — ou nenhuma é.
