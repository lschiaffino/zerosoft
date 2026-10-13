---
title: "Como construímos o Link: a arquitetura completa cabe numa página"
description: "Next.js, SQLite e um route handler que responde em milissegundos. A arquitetura inteira do encurtador, sem filas nem cache externo."
date: "2026-06-25"
author: "zerosoft"
tags: ["link", "arquitetura", "open source"]
---

A maioria dos encurtadores "enterprise" descreve sua arquitetura com diagramas de quinze caixas. A nossa cabe neste post. Não por falta de ambição: um encurtador de links não precisa de mais.

## O redirect é um route handler, não uma plataforma

O Link é Next.js com App Router. Todo o produto passa por um route handler que faz exatamente três coisas: ler, registrar, redirecionar.

```ts
// app/[slug]/route.ts
export function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const link = getLink(params.slug); // SELECT por slug indexado
  if (!link || expired(link) || maxedOut(link)) {
    return new Response("Not found", { status: 404 });
  }
  if (link.password && !authorized(req, link)) {
    return NextResponse.redirect(`/gate/${params.slug}`, 302);
  }

  recordClick(req, link.id); // INSERT de ~200 bytes
  return NextResponse.redirect(link.url, 302);
}
```

Medido no VPS mais barato que encontramos: menos de 3 milissegundos de ponta a ponta, p99 incluído. A latência que você sente é a da rede, não a nossa.

## SQLite, sério mesmo

O banco é SQLite com better-sqlite3, em modo WAL. Para essa carga é uma decisão de engenharia, não um atalho:

- **Síncrono e em processo:** sem rede, sem pool de conexões. Um `SELECT` é uma consulta de microssegundos.
- **Um arquivo:** backup é copiar o arquivo. Restore é colar. Migrar de servidor é um `scp`.
- **Escala de sobra:** milhões de linhas indexadas respondem em milissegundos. Nosso usuário mais pesado está a décadas do limite.

## Analytics sem cookies

Não usamos tracker, pixel nem fingerprint. Tudo sai dos headers que o navegador já manda em cada request:

```ts
function recordClick(req: NextRequest, linkId: string) {
  const ua = parseUA(req.headers.get("user-agent")); // device, browser, os
  db.prepare(`INSERT INTO clicks
    (link_id, ts, referrer, country, device, browser, os)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    linkId,
    Date.now(),
    domainOf(req.headers.get("referer")),    // só o domínio
    req.headers.get("cf-ipcountry") ?? null, // país, sem tocar o IP
    ua.device, ua.browser, ua.os
  );
}
```

Guardamos o domínio do referrer, não a URL completa. O país vem do header do edge, não de geolocalizar o IP, que sequer armazenamos.

## QR on-demand

Os QRs não são gerados com antecedência nem guardados: são calculados a cada request em `/qr/[slug].svg`. É um algoritmo determinístico sobre uma string; armazená-los seria pagar disco para guardar algo que se recalcula de graça em um milissegundo.

## O que não usamos (e por quê)

- **Redis:** o SQLite em WAL já lê em microssegundos. Um cache seria mais uma peça para manter sem ganhar nada.
- **Kafka / filas de eventos:** o `INSERT` de analytics faz parte do request e custa menos de um milissegundo. Uma fila é a solução para um problema que não temos.
- **Microsserviços:** um encurtador é um processo. Dividi-lo em cinco transforma cada deploy numa coreografia e cada bug numa investigação distribuída.

Arquitetura entediante é uma feature: menos peças para falhar às 3 da manhã. Todo o código é aberto: audite cada linha.
