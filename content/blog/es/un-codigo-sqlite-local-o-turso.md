---
title: "Un código, dos bases: un archivo SQLite local o Turso remoto"
description: "zerosoft corre sobre un archivo SQLite en tu disco o sobre una base Turso remota, y lo cambia una variable de entorno. Cómo funciona en el código, qué cambia y cómo elegir."
date: "2026-10-10"
author: "zerosoft"
tags: ["ingeniería", "sqlite", "self-hosting"]
---

Ya defendimos que [SQLite es suficiente](/blog/sqlite-es-suficiente) para apps como la nuestra. Este post es sobre algo más acotado y más práctico: el mismo código de zerosoft corre sobre un archivo SQLite al lado de la app *y* sobre una base remota en [Turso](https://turso.tech), y lo único que cambia es una variable de entorno.

zerosoft Cloud corre en Vercel + Turso. Un contenedor de self-host corre sobre un archivo. Mismas queries, mismas migraciones, mismos tests. Acá va cómo, y entre qué estás eligiendo de verdad.

## El interruptor son cuatro líneas

De `lib/db.ts`:

```ts
const DB_PATH = path.join(process.cwd(), 'data', 'zerosoftware.db');
const DB_URL = process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`;
const IS_REMOTE = !DB_URL.startsWith('file:');

createClient({ url: DB_URL, authToken: IS_REMOTE ? process.env.TURSO_AUTH_TOKEN : undefined });
```

Funciona gracias al cliente de abajo: `@libsql/client`. libSQL es el fork open source de SQLite que mantiene Turso, y su cliente le habla tanto a un archivo local (URLs `file:`) como a un servidor remoto (URLs `libsql://`) con la misma API. El dialecto SQL es el de SQLite en los dos casos, así que no hay nada que traducir.

Entonces:

```bash
# Archivo local (el default): dejala vacía
TURSO_DATABASE_URL=

# Turso remoto
TURSO_DATABASE_URL=libsql://zerosoft-yourorg.turso.io
TURSO_AUTH_TOKEN=...   # turso db tokens create <db>
```

Un detalle simpático: el `Dockerfile` usa este mismo interruptor durante el build. Next.js prerenderiza algunas páginas en `npm run build`, y eso necesita una base, así que el build corre con `TURSO_DATABASE_URL=file:/tmp/build.db`: un archivo descartable que nunca llega a la imagen final.

## Qué hace distinto el código

Casi nada, y esa es la idea. Las diferencias que existen son a propósito:

- **Los PRAGMAs solo corren en local.** Sobre un archivo, la app prende `foreign_keys`, pone `busy_timeout = 5000` (esperar hasta 5 segundos por un lock en vez de fallar) y pasa a `journal_mode = WAL`. En una base remota esa configuración es del servidor, así que la app no la manda.
- **El directorio de datos solo se crea en local.** `data/` recibe un `mkdir -p` cuando la URL es un archivo.

Todo lo demás pasa por un wrapper chiquito. La app originalmente estaba escrita contra `better-sqlite3`, que es sincrónico. El cliente de libSQL es async: tiene que serlo, porque el caso remoto es una llamada de red. En vez de reescribir cada query, `getDb()` devuelve un shim con la misma forma (`prepare(sql).get/all/run`) donde cada método devuelve una promesa. Además copia los objetos de fila de libSQL a objetos JS planos, para poder pasarlos de React Server Components a componentes cliente sin sorpresas. Para trabajo de varias sentencias que tiene que ser atómico, el código abre una transacción interactiva con `getClient().transaction()` y la envuelve con `txDb(tx)`, misma interfaz.

Las migraciones corren igual en los dos casos: de forma perezosa, antes de la primera query, una sola lista para todas las bases. ([Más sobre eso](/blog/migraciones-versionadas-sin-orm).)

## La diferencia real: dónde viven los bytes

Mismo código no significa mismo comportamiento. Los tradeoffs son físicos.

**Latencia por query.** Un archivo local es in-process: una query es una llamada a función, sin red. Una query a Turso es un viaje de ida y vuelta. Para una query no importa, pero se multiplica. Algunas pantallas corren varias queries en secuencia, y unas pocas hacen una query por fila (listar los webhooks busca la última entrega de cada uno por separado, por ejemplo). Sobre un archivo nadie lo nota. Sobre la red, se suma. Si te vas a remoto, poné la app y la base en la misma región: importa más que cualquier optimización de queries.

**Dónde puede correr la app.** Un archivo necesita un disco persistente y, siendo realistas, un único proceso escribiendo. Eso es un VPS o un contenedor con un volumen. Las plataformas serverless como Vercel no te dan ni un filesystem durable ni una única instancia, así que ahí la base *tiene* que ser remota. Por eso zerosoft Cloud usa Turso.

**Escrituras concurrentes.** SQLite tiene un escritor por vez. En local, `busy_timeout` hace que los escritores concurrentes esperen su turno en vez de tirar error, y WAL deja seguir leyendo mientras se escribe. Con Turso, el servidor serializa las escrituras por vos, y se pueden conectar muchas instancias de la app a la vez.

**Backups y operación.** Un archivo lo backupeás vos: la [guía de Docker](/blog/self-hosting-con-docker-paso-a-paso) muestra cómo hacerlo de forma segura con la app corriendo. Turso es un servicio administrado: backups y restore son parte de la plataforma (revisá en su documentación qué incluye tu plan). Cambiás un cron por un proveedor.

**Costo.** Un archivo cuesta lo que cueste tu disco. Turso tiene un plan gratis y planes pagos por encima: mirá su página de precios actual en vez de confiar en un número de un post de blog.

## Cómo pasar de uno a otro

Como los dos lados son compatibles con SQLite, mudarse es copiar datos, no un proyecto de migración.

De archivo local a Turso: pará la app (para que el WAL se vuelque al archivo principal) y dejá que el CLI de Turso cree una base a partir del archivo:

```bash
sqlite3 data/zerosoftware.db "PRAGMA wal_checkpoint(TRUNCATE);"
turso db create zerosoft --from-file data/zerosoftware.db
```

De Turso de vuelta a un archivo, dump y carga:

```bash
turso db shell zerosoft .dump > zerosoft.sql
sqlite3 data/zerosoftware.db < zerosoft.sql
```

Los flags cambian entre versiones del CLI, así que corré `turso db create --help` antes de confiar en los nuestros. En cualquier caso, apuntá las variables de entorno al nuevo lugar, arrancá la app, y el runner de migraciones ve la tabla `schema_migrations` existente y no hace nada.

Esa también es la respuesta honesta a "¿y si Turso desaparece?": tus datos son una base SQLite. Hacés el dump y volvés a un archivo.

## Cómo elegir

Usá un **archivo local** si:

- Hacés self-host en un VPS o en una sola máquina.
- Querés cero dependencias externas y la menor latencia posible.
- No te molesta hacerte cargo de los backups (un comando por noche, probado cada tanto).
- Necesitás que funcione offline o en una red aislada.

Usá **Turso** si:

- Deployás en serverless (Vercel y compañía) o corrés más de una instancia de la app.
- Preferís backups y restore administrados antes que correrlos vos.
- Tu app y tu base pueden vivir en la misma región.

Lo que (todavía) no hacemos: libSQL también soporta réplicas embebidas (una copia local que se sincroniza desde un primario remoto), que podrían combinar lecturas locales rápidas con una fuente de verdad remota. zerosoft hoy no las usa. Y no hay opción de Postgres; todo el código habla SQLite.

Un código, una variable de entorno, y tus datos en un formato que siempre te podés llevar. Arrancá con el archivo. Mudate cuando tengas un motivo.
