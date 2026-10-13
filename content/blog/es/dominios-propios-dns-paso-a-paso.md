---
title: "Dominios propios para tus links cortos: DNS, paso a paso"
description: "Cómo servir los links de Link desde go.tuempresa.com: qué registro DNS crear, cómo funciona la verificación en zerosoft Cloud y en tu propio servidor, y dónde suele trabarse."
date: "2026-07-21"
author: "zerosoft"
tags: ["link", "dns", "dominios"]
---

`go.tuempresa.com/lanzamiento` le dice al lector quién manda el link; un dominio genérico, no. Link acepta dominios propios y configurar uno es un registro DNS y un botón. Este post cuenta qué pasa en zerosoft Cloud y en tu propio servidor, incluidas las partes que suelen salir mal.

## Antes de arrancar

- **Usá un subdominio.** `go.`, `l.`, `links.`: lo que quieras. Podés usar un dominio raíz (`tuempresa.link`), pero los subdominios se llevan mejor con los proveedores de DNS, ya vas a ver por qué.
- **Tené acceso al DNS.** Cloudflare, Route 53, el panel de tu registrador: donde viva la zona.
- **Sé admin del workspace.** Agregar un dominio es solo para admins. Una vez verificado, aparece como opción para cualquiera del workspace que cree un link.

## Paso 1: agregá el dominio

Andá a la configuración de Link, abrí **Dominios propios**, escribí `go.tuempresa.com` y tocá **Agregar dominio**. Se chequean tres cosas en el momento:

- Que sea un hostname válido (sin path, sin puerto).
- Que no sea un host que ya sirve la app (más sobre esto en la parte de self-host).
- Que no lo esté usando otra cuenta. Un dominio, un dueño.

El dominio queda en **Esperando DNS**, con una tablita que te dice exactamente qué registro crear.

## Paso 2: creá el registro DNS

Lo que dice la tabla depende de dónde corre Link.

### En zerosoft Cloud (y cualquier deploy en Vercel)

Cuando el servidor tiene `VERCEL_TOKEN` y `VERCEL_PROJECT_ID` (más `VERCEL_TEAM_ID` si el proyecto está en un team), agregar un dominio también lo registra en el proyecto de Vercel vía su API. El registro que creás es:

```
# subdominio (go.tuempresa.com)
CNAME   go   cname.vercel-dns.com

# dominio raíz (tuempresa.link)
A       @    76.76.21.21
```

Vercel emite el certificado HTTPS solo, cuando el DNS resuelve. No tocás certificados.

### En tu propio servidor

Dejá vacías las variables `VERCEL_*`. Ahí la instrucción es un CNAME que apunta al host de tu propia app: el de `SHORT_DOMAIN`, o `NEXTAUTH_URL` si esa no está:

```
# supongamos que tu instancia de Link corre en links.ejemplo.org
CNAME   go   links.ejemplo.org
```

Para un dominio raíz la tabla dice `CNAME @`, que muchos proveedores no permiten. Dos salidas: usar el CNAME flattening / registro ALIAS de tu proveedor, o crear registros A (y AAAA) con las mismas IPs que el host de la app. La verificación acepta las dos cosas, ya vas a ver.

**El HTTPS acá es tuyo.** Los links cortos en dominios propios siempre se generan con `https://`, así que lo que tengas delante de la app (Caddy, nginx con certbot, un load balancer) necesita un certificado para `go.tuempresa.com`. Link rutea el request; no emite certificados.

## Paso 3: verificá

Los cambios de DNS tardan entre segundos y un buen rato. Cuando creas que ya está, tocá **Verificar**. Si todavía no, vas a ver "El DNS todavía no apunta acá": esperá y probá de nuevo. La verificación tiene rate limit por IP, así que machacar el botón no ayuda.

Qué chequea "verificar" en realidad:

- **Modo Vercel:** le pregunta a Vercel la configuración del dominio y pasa cuando Vercel dice que ya no está mal configurado.
- **Modo self-host:** resuelve el CNAME de tu dominio. Si apunta al host de la app, listo. Si no, compara IPs: todas las direcciones a las que resuelve tu dominio tienen que estar entre las del host de la app. Por eso funcionan los registros A y los CNAME aplanados para dominios raíz.

Una vez verificado, el badge se pone verde y el dominio aparece en el selector **Dominio** al crear un link (y por la API, pasando `"domain": "go.tuempresa.com"` a `POST /api/v1/links`).

## Qué cambia en un dominio propio

Esta es la parte que nadie espera, para bien.

**No hay palabras reservadas.** En el dominio por defecto, un slug no puede ser `blog`, `docs`, `app`, `api`, `status`, `login` ni un par de docenas de palabras reservadas más, porque esos paths son del sitio. En tu dominio, todo `/<algo>` es un link corto. Así que `go.tuempresa.com/blog` o `go.tuempresa.com/app` valen perfecto. Las únicas excepciones son `en`, `es` y `pt` (ahí viven la página de password y la de "link caído") y el interno `__root`.

**Los slugs son por dominio.** `zerosoft.ai/promo` y `go.tuempresa.com/promo` son links distintos y pueden ir a lugares distintos. El mismo slug puede existir una vez por dominio.

**La raíz puede redirigir.** Por defecto, quien abre `go.tuempresa.com/` sin slug cae en la home de zerosoft. Después de verificar, configurá un **Redirect de la raíz** (tu home, por ejemplo) y el dominio pelado va ahí.

**Todo lo demás funciona igual.** Passwords, vencimiento, límite de clicks, QR (generados con tu dominio adentro), analytics y el webhook `link.clicked`, cuyo payload incluye el dominio.

## APP_HOSTS: la trampa del self-host

El middleware tiene que decidir, en cada request, si el host es "la app" o "un dominio propio de links". En un dominio propio, cualquier path de un solo segmento se trata como slug, lo que rompería el dashboard si tu host de la app quedara mal clasificado.

La app reconoce sus propios hosts a partir de `NEXTAUTH_URL`, `SHORT_DOMAIN`, las URLs de Vercel, `localhost` y todo lo que termine en `.vercel.app`. Si servís la app desde hostnames **extra**, un nombre interno, un segundo dominio público, listalos:

```
APP_HOSTS=links.ejemplo.org,links.interno.lan
```

Separados por coma, sin paths. Los hosts de esta lista no se pueden agregar como dominios propios, y los requests a ellos se comportan como la app normal.

## Borrar un dominio

No podés borrar un dominio que todavía tiene links. Es a propósito: borrarlo rompería cada QR impreso y cada link que ya anda dando vueltas. Mové o borrá esos links primero y después sacá el dominio. En modo Vercel, borrarlo también lo desvincula del proyecto.

## Si venís de otro acortador

Si tus links ya viven en `go.tuempresa.com` en Bitly, el orden importa. El [import de Bitly](/blog/migrar-de-bitly-a-link) conserva los back-halves en un dominio propio solo si ese dominio **ya está verificado** acá, y verificar implica que el DNS ya apunta acá. Entonces: bajá el TTL del registro un día antes, cambiá el DNS, verificá y corré el import en el momento. Las URLs viejas siguen andando, con un hueco de minutos en vez de un fin de semana roto.

## Checklist

1. Agregá `go.tuempresa.com` en Dominios propios (admin).
2. Creá el registro de la tabla: CNAME a `cname.vercel-dns.com` en Cloud, CNAME al host de tu app en self-host.
3. Self-host: asegurate de que tu proxy tenga certificado para el host nuevo, y configurá `APP_HOSTS` si servís la app desde hostnames extra.
4. Tocá **Verificar** hasta que esté verde.
5. Opcional: configurá el redirect de la raíz.
6. Creá links y elegí el dominio.

Un registro DNS, ningún plan premium. Tu dominio siempre fue tuyo; ahora tus links también.
