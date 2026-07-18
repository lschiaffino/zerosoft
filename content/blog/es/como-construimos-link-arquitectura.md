---
title: "Cómo construimos Link: la arquitectura completa entra en una página"
description: "Next.js, SQLite y un route handler que responde en milisegundos. Sin Redis, sin Kafka, sin microservicios. Así está hecho un acortador honesto."
date: "2026-06-25"
author: "Zerosoftware"
tags: ["link", "arquitectura", "open source"]
---

La mayoría de los acortadores "enterprise" describe su arquitectura con diagramas de quince cajas. La nuestra entra en este post. No por falta de ambición: porque un acortador de links no necesita más.

## El redirect es un route handler, no una plataforma

Link es Next.js con App Router. Todo el producto pasa por un route handler que hace exactamente tres cosas: leer, registrar, redirigir.

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

Medido en el VPS más barato que encontramos: menos de 3 milisegundos de punta a punta, p99 incluido. La latencia que percibís es la de la red, no la nuestra.

## SQLite, en serio

La base es SQLite con better-sqlite3, en modo WAL. Para esta carga es una decisión de ingeniería, no un atajo:

- **Sincrónico y en proceso:** sin red, sin pool de conexiones. Un `SELECT` es un lookup de microsegundos.
- **Un archivo:** backup es copiar el archivo. Restore es pegarlo. Migrar de servidor es un `scp`.
- **Escala de sobra:** millones de filas indexadas responden en milisegundos. Nuestro usuario más pesado está a décadas del límite.

## Analytics sin cookies

No hay tracker, ni píxel, ni fingerprint. Todo sale de los headers que el browser ya manda en cada request:

```ts
function recordClick(req: NextRequest, linkId: string) {
  const ua = parseUA(req.headers.get("user-agent")); // device, browser, os
  db.prepare(`INSERT INTO clicks
    (link_id, ts, referrer, country, device, browser, os)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    linkId,
    Date.now(),
    domainOf(req.headers.get("referer")),    // solo el dominio
    req.headers.get("cf-ipcountry") ?? null, // país, sin tocar la IP
    ua.device, ua.browser, ua.os
  );
}
```

Guardamos el dominio del referrer, no la URL completa. El país viene del header del edge, no de geolocalizar la IP — que ni siquiera almacenamos.

## QR on-demand

Los QR no se generan por adelantado ni se guardan: se calculan en cada request a `/qr/[slug].svg`. Es un algoritmo determinista sobre un string; almacenarlo sería pagar disco para guardar algo que se recomputa gratis en un milisegundo.

## Lo que no usamos (y por qué)

- **Redis:** SQLite en WAL ya lee en microsegundos. Un cache sería otra pieza que mantener para ganar nada.
- **Kafka / colas de eventos:** el `INSERT` de analytics es parte del request y cuesta menos de un milisegundo. Una cola es la solución a un problema que no tenemos.
- **Microservicios:** un acortador es un proceso. Dividirlo en cinco convierte cada deploy en una coreografía y cada bug en una investigación distribuida.

La arquitectura aburrida es una feature: hay menos piezas que puedan fallar a las 3 de la mañana. Todo el código es abierto — auditá cada línea.
