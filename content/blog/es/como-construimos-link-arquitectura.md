---
title: "La arquitectura de Link en una página"
description: "Next.js, SQLite (o Turso) y un route handler que lee, registra el clic y redirige. Sin Redis, sin colas y sin microservicios. Cómo está hecho y por qué alcanza."
date: "2026-06-25"
author: "zerosoft"
tags: ["link", "arquitectura", "open source"]
---

Muchos acortadores describen su arquitectura con diagramas de quince cajas. La de Link entra en este post, porque un acortador no necesita más.

## El redirect es un route handler

Link es una app de Next.js con App Router. Cada link corto pasa por `app/r/[slug]/route.ts`, que hace tres cosas: buscar el link, registrar el clic y redirigir. Simplificado:

```ts
export async function GET(req: NextRequest, { params }) {
  const { slug } = await params;
  const link = await getLinkForHost(host, slug); // SELECT por slug indexado
  if (!link || link.archived) return gone('notfound');
  if (isExpired(link)) return gone('expired');
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) return gone('limit');
  if (link.password_hash && !validGateCookie(req, link)) {
    return NextResponse.redirect(`/gate/${slug}`); // pide la contraseña
  }
  await recordClick(link.id, contextFromHeaders(req.headers)); // INSERT chico
  after(() => emitEvent(link.user_id, 'link.clicked', { /* … */ }));
  return NextResponse.redirect(link.url, link.redirect_type);
}
```

El clic se registra antes de responder (un `INSERT` chico). El webhook `link.clicked` sale con `after()`, después de la respuesta, así el redirect no espera a nadie.

## SQLite

La base es SQLite a través de `@libsql/client`. La misma app puede usar un archivo local o una base Turso remota, según una variable de entorno (lo contamos en [un código, dos bases](/blog/un-codigo-sqlite-local-o-turso)). Para esta carga, SQLite alcanza de sobra:

- **En proceso:** sin red ni pool de conexiones en modo local. Un `SELECT` por índice tarda microsegundos.
- **Un archivo:** el backup es una copia consistente de ese archivo y mudarse de servidor es copiarlo.
- **Escala:** millones de filas indexadas responden en milisegundos.

## Métricas sin cookies

Todo sale de los headers que el navegador ya manda (`lib/track.ts`):

- **Referrer:** solo el dominio, sin `www.`, o `direct`.
- **País:** en Vercel, del header `x-vercel-ip-country`; en tu servidor, de una base geográfica local. La IP no se guarda.
- **Dispositivo, navegador y sistema:** del `User-Agent`, con ua-parser.

Cada clic es un `INSERT` en `clicks` con esas seis columnas y un `UPDATE` del contador del link, en la misma transacción.

## QR bajo demanda

Los QR no se guardan: se generan en cada pedido a `/api/links/:id/qr`, en SVG o PNG. Es un algoritmo determinista sobre un string; guardarlo sería ocupar disco con algo que se recalcula en un milisegundo.

## Lo que no usamos

- **Redis:** SQLite ya lee en microsegundos. Un cache sería otra pieza que mantener.
- **Colas de eventos:** el `INSERT` de un clic cuesta menos de un milisegundo, y los webhooks salen después de responder.
- **Microservicios:** un acortador es un proceso. Partirlo en cinco complica cada deploy y cada bug.

Menos piezas son menos cosas que fallan a las 3 de la mañana. El código está en GitHub.
