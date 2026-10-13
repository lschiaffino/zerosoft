---
title: "APIs abertas: por que documentamos tudo"
description: "A API v1 pública está documentada endpoint por endpoint em /docs. Uma API completa é o jeito mais simples de garantir que você pode sair quando quiser."
date: "2026-05-27"
author: "zerosoft"
tags: ["api", "open source", "link"]
---

Um teste rápido para avaliar um produto: olhe a API. Se ela existe, está documentada e faz o que a interface faz, você consegue automatizar o que quiser e sair quando quiser. Se são três endpoints escondidos e um "fale com vendas para ter acesso", você depende do fornecedor.

Nós começamos pelo outro lado. O Link é API-first: a interface web é só mais um cliente da API pública. Tudo o que você faz com o mouse, você faz com curl.

## A API v1, completa

A API v1 do Link está disponível hoje, documentada endpoint por endpoint em /docs, sem seções de "coming soon" disfarçadas:

- **Criar links**: `POST /api/v1/links` com alias customizado, senha, data de expiração, máximo de cliques, tags e parâmetros UTM.
- **Listar e buscar**: `GET /api/v1/links` com filtros por tag e domínio.
- **Estatísticas**: `GET /api/v1/links/:id/stats` com cliques por dia, referrer, país, dispositivo, navegador e sistema operacional. Sem cookies, sem fingerprinting: os mesmos dados do dashboard.
- **QR codes**: geração em SVG e PNG.

A autenticação é uma API key no header `Authorization: Bearer`. Você gera e revoga as chaves na sua conta, sem abrir ticket de suporte. Os rate limits são públicos e vêm nos headers `X-RateLimit-*` de cada resposta: você sabe exatamente quantas requisições ainda tem antes de bater no teto. Os erros são JSON com códigos estáveis, não HTML de surpresa.

```bash
curl -X POST https://zerosoft.ai/api/v1/links \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://suaempresa.com/lancamento", "alias": "lancamento"}'
```

## A garantia anti-lock-in que funciona de verdade

Todo mundo promete "sem lock-in". A maioria quer dizer "você pode exportar um CSV se achar o botão". Uma API aberta é uma promessa diferente, e verificável:

1. **Você pode automatizar a sua saída.** Um script de vinte linhas percorre seus links, baixa suas estatísticas e as reconstrói em outro lugar. Sem precisar da nossa cooperação.
2. **Você se integra sem pedir permissão.** Seu CRM, seu CI, sua newsletter. Se fala HTTP, fala com o Link.
3. **O plano B já existe.** O código é open source. Se desaparecermos amanhã, a sua automação aponta para o seu próprio servidor e continua igual. A API é a mesma porque o software é o mesmo.

Uma empresa que entrega uma API completa está entregando a porta de saída, acesa e destrancada. Nós a documentamos porque temos certeza de que você vai ficar pelo quanto funciona bem, não pelo quanto é difícil ir embora.

## O que vem a seguir

- **Webhooks**: eventos de clique em tempo real para o seu endpoint, para reagir no momento em que algo acontece.
- **Endpoints por produto**: CRM, Cal e Agents já têm endpoints na API v1, ao lado do Link. Track ainda não tem API pública. A regra é a mesma para todos: documentado primeiro, estável depois.

A interface é para as pessoas. A API é para a sua empresa. As duas precisam ser de primeira classe, ou nenhuma é.
