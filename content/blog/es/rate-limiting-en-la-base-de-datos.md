---
title: "Rate limiting sin Redis: una tabla y un UPSERT"
description: "Cómo Zerosoft limita su API y sus endpoints públicos con un contador de ventana fija guardado en la misma base SQLite/libSQL, y cuándo eso deja de ser buena idea."
date: "2026-09-10"
author: "Zerosoftware"
tags: ["ingeniería", "arquitectura", "sqlite"]
---

Preguntale a internet cómo poner rate limiting en una app web y la respuesta llega en menos de un segundo: Redis. `INCR`, `EXPIRE`, listo. Es una buena respuesta. También es un servicio más para correr, asegurar, monitorear y pagar — y para un proyecto cuyo self-host es "un contenedor, un archivo", un servicio más es un costo real.

Así que Zerosoft hace rate limiting en la base que ya tiene. Acá va cómo funciona, por qué es correcto y dónde se queda corto.

## El problema: los contadores tienen que ser compartidos

La primera versión obvia es un `Map` en memoria: clave → contador. Anda perfecto en tu notebook y no sirve para nada en producción.

Zerosoft Cloud corre sobre funciones serverless. Cada instancia tiene su propia memoria, las instancias van y vienen, y una ráfaga de tráfico se puede repartir entre una docena. Un límite en memoria de 100 por minuto se convierte en "100 por minuto por instancia, multiplicado por las instancias que existan ahora". Eso no es un límite, es una sugerencia.

El contador tiene que vivir en un lugar que todas las instancias vean. Redis es uno. La base de datos es otro — y esa ya la pagamos.

## La implementación entera

Está en `lib/rate-limit.ts` y es corta. La tabla:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
```

Y el chequeo, una sentencia por request:

```ts
const windowStart = Math.floor(now / windowMs) * windowMs;
const row = await db.prepare(
  `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
   ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
   RETURNING count`,
).get(key, windowStart, windowStart + windowMs);

return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs };
```

Eso es una **ventana fija**. El tiempo se corta en baldes alineados al reloj (cada minuto arranca en :00), y cada clave tiene un contador por balde.

Lo importante es que el incremento y la lectura son la misma sentencia. No hay "leer el contador, sumar uno, escribirlo" en código de aplicación — el patrón que se rompe con concurrencia porque dos requests leen 99, las dos escriben 100 y las dos pasan. SQLite ejecuta el UPSERT de forma atómica, y `RETURNING` devuelve el valor que acaba de escribir. Dos requests simultáneas reciben 100 y 101, no 100 y 100.

## La limpieza

Cada ventana deja una fila. En vez de un job aparte, la limpieza es perezosa: como mucho una vez por minuto por instancia, una request dispara un `DELETE FROM rate_limits WHERE expires_at < ?` y no lo espera. El índice sobre `expires_at` lo mantiene barato. La tabla se mantiene chica sin que nadie piense en ella.

## Dónde se usa

Sobre `rateLimit()` hay dos capas.

**La API.** Cada request a `/api/v1` está limitada a **100 por minuto por key**. El balde es el SHA-256 de la key, y el chequeo corre *antes* de validarla — así que adivinar keys gasta el mismo presupuesto. Las requests con keys inválidas tienen un segundo límite: 20 por minuto por IP. (La [guía de la API](/blog/api-rest-v1-con-claves-personales) cuenta qué ve el cliente.)

**Endpoints públicos.** `limitByIp()` arma la clave con un nombre de balde más la IP del cliente, y devuelve un `429` listo con header `Retry-After`. Algunos valores reales del código:

- Reservar un horario en Cal: 10 cada 10 minutos.
- Pedir los horarios disponibles: 120 por minuto.
- La puerta de un link con contraseña: 30 por minuto por IP, más 5 por minuto por IP *y* por link.
- Mandar un mensaje desde el widget de chat: 30 por minuto.
- Importar links (desde Bitly o un CSV): 5 cada 10 minutos.

Para pruebas de carga locales, `RATE_LIMIT_DISABLED=true` apaga los límites por IP.

## El problema de la IP

Un límite por IP vale lo que vale la IP que leés. `clientIp()` toma `x-vercel-forwarded-for`, después la primera entrada de `x-forwarded-for`, después `x-real-ip`. En Vercel esos headers los pone el edge, no el cliente. Cuando hacés self-host, los pone tu reverse proxy — así que configuralo para que pise `X-Forwarded-For` en vez de agregarle, o un cliente puede mandar el suyo. La [guía de Docker](/blog/self-hosting-con-docker-paso-a-paso) tiene la línea para Nginx.

## Los tradeoffs, sin maquillaje

Este diseño es una decisión, no un almuerzo gratis.

**Cada request limitada es una escritura.** Contra un archivo SQLite local son microsegundos, pero SQLite tiene un único escritor, así que las escrituras del rate limit hacen fila con todas las demás. Contra Turso es un viaje de red. Redis hace un `INCR` en memoria en bastante menos de un milisegundo. Si estás limitando decenas de miles de requests por segundo, la base de datos es el lugar equivocado.

**Las ventanas fijas permiten ráfagas en los bordes.** Un cliente puede mandar 100 requests a las 12:00:59 y otras 100 a las 12:01:00. En esos dos segundos pasaron 200. Las ventanas deslizantes o los token buckets lo resuelven; en Redis son fáciles con un script Lua y en SQL son incómodos. Para límites de "frenar abusos", la ventana fija alcanza. Para cuotas de facturación estrictas, no.

**Las requests rechazadas también cuentan.** El UPSERT siempre incrementa, así que un cliente que sigue martillando después del límite hace crecer el contador. Es inofensivo — se resetea en la próxima ventana —, pero no uses `count` como métrica de tráfico legítimo.

**Destino compartido.** Si la base se cae, el rate limiting se cae con ella. Lo consideramos una virtud: si la base está caída, nada más funciona tampoco, y una dependencia falla de forma más simple que dos.

## Cuándo pasarse a Redis

Sacá los contadores de la base cuando se cumpla alguna de estas:

- Las escrituras del rate limit son una parte significativa del total de escrituras de tu base.
- La latencia extra por request aparece en tu p99.
- Necesitás ventanas deslizantes, token buckets o precisión por segundo.
- Ya corrés Redis para otra cosa, así que el argumento de la infraestructura extra desaparece.

Hasta entonces, una tabla, un índice y un UPSERT hacen el trabajo — y quien hace self-host tiene rate limiting con cero contenedores extra.
