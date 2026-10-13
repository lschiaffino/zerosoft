---
title: "De Bitly a Link: qué se importa y qué no"
description: "Cómo importar tus links de Bitly a Link con un token de API o un CSV: qué se importa, qué no, cómo se conservan los back-halves y en qué orden hacerlo si usás dominio propio."
date: "2026-08-20"
author: "zerosoft"
tags: ["link", "bitly", "migración"]
---

Cambiar de acortador tiene un miedo muy particular: en algún lado hay flyers impresos, tweets viejos y PDFs con tus links cortos adentro. Si los rompés, no hay segunda oportunidad.

Por eso armamos el import de Bitly en Link alrededor de un objetivo: conservar los back-halves. `go.tuempresa.com/promo-primavera` tiene que seguir siendo `go.tuempresa.com/promo-primavera` después de la mudanza. Acá va cómo funciona el import, exactamente qué trae, qué no, y el orden de pasos que evita links rotos.

## Dos puertas: token de API o CSV

Las dos están en la configuración de Link, en **Importar desde Bitly**.

**Token de API.** En Bitly, andá a Settings → API y generá un access token. Pegalo en Link y tocá **Importar**. Link usa el token una sola vez para leer tus links por la API de Bitly y no lo guarda. Podés (y deberías) revocarlo en Bitly después.

**Archivo CSV.** Exportá tus links desde Bitly (Links → Export) y subí el archivo. El parser es tolerante: busca una columna cuyo encabezado mencione `long`, `destination`, `original`, `target` o sea simplemente `url` para el destino; una columna `bitlink`, `short`, `link` o `custom` para la URL corta; más `title` y `tags` si existen. Los tags pueden venir separados por `|`, `;` o `,`. Eso también significa que sirve el CSV de casi cualquier otro acortador, mientras tenga una columna de destino. El límite del archivo es 5 MB.

## Qué se importa

De cada link:

- **La URL de destino.** Incluyendo los parámetros UTM que ya tuviera.
- **El título.**
- **Los tags**, hasta cinco por link (es el límite de Link; los que sobran se descartan).
- **El back-half**, cuando se puede. Más abajo el detalle.

Por API, el import lee todos los bitlinks del **grupo por defecto** de tu cuenta, activos y archivados. Si un link tiene un back-half custom en tu propio dominio, se importa esa versión, porque es la que la gente realmente tiene.

## Qué no se importa

Mejor saberlo antes de arrancar:

- **El historial de clicks.** Tus analytics en Link arrancan en cero el día del import. Si necesitás los números históricos, exportalos de Bitly y guardá ese archivo. No inventamos datos pasados.
- **Los dominios propios.** El dominio en sí se agrega y se verifica en Link por separado (ver abajo).
- **El estado de archivado.** Los bitlinks archivados entran como links activos. Archivalos de nuevo en Link si tienen que seguir muertos.
- **Otros grupos.** La vía de API solo lee el grupo por defecto. Si usás varios grupos en Bitly, exportá cada uno a CSV.
- **Diseños de QR, campañas y todo lo específico de las apps de Bitly.** Link genera su propio QR plano (SVG y PNG) para cada link, apuntando a la misma URL corta.

## Cómo se conservan los back-halves

Esta es la parte que importa. Para cada link, el import mira el host y el path de la URL corta:

1. **Si el host es un dominio propio que ya verificaste en Link**, el link se crea en ese dominio con el mismo back-half. `go.tuempresa.com/promo-primavera` queda exactamente así.
2. **Si no** (incluido todo lo que está en `bit.ly`), el link se crea en el dominio por defecto con el mismo back-half, si está libre y es válido.
3. **Si el back-half está tomado o no es válido** (por ejemplo, una palabra reservada como `blog` en el dominio por defecto, o más de 32 caracteres), Link genera uno nuevo al azar.

Al final te queda un reporte: cuántos links se importaron, cuántos conservaron su back-half, la lista completa de los que cambiaron (viejo → nuevo) y los que se saltearon con el motivo, normalmente una URL de destino inválida.

Una verdad inevitable: **los links en `bit.ly` van a seguir dependiendo de Bitly.** El import los recrea como `zerosoft.ai/abc123`, pero nadie puede mover el DNS de `bit.ly`. Lo que imprimiste con `bit.ly` sigue andando mientras Bitly lo sirva. Este es el mejor argumento para usar tu propio dominio, elijas el acortador que elijas.

## El orden correcto con dominio propio

Acá está la trampa: el import conserva back-halves en un dominio propio solo si ese dominio ya está verificado en Link, y la verificación chequea que el DNS apunte a Link. O sea que tus links de Bitly en ese dominio dejan de resolver en Bitly en el momento en que cambiás el DNS.

Así que hacelo en este orden:

1. **Exportá el CSV de Bitly** (o tené a mano el token de API). Antes de tocar el DNS.
2. **Un día antes, bajá el TTL** del registro de `go.tuempresa.com` en tu proveedor de DNS, para que el cambio propague rápido.
3. **Agregá el dominio en Link** y anotá el registro que te pide ([detalle del DNS acá](/blog/dominios-propios-dns-paso-a-paso)).
4. **Cambiá el registro DNS** y tocá **Verificar** hasta que se ponga verde.
5. **Corré el import en el momento.** Los links caen en tu dominio con sus back-halves.
6. **Probá a mano** algunas URLs viejas, incluidas las más clickeadas.

El hueco entre el paso 4 y el 5 es de minutos. Mientras tanto, los visitantes ven una página prolija de "Este link ya no está" en vez de un error, y después todo vuelve a andar.

## Cuentas grandes: el límite de 2.000

Cada corrida del import procesa hasta 2.000 links. Si tenés más, el reporte te avisa. No vuelvas a correr el mismo import por API sin más: arranca desde el principio, los primeros 2.000 back-halves ya están tomados, y terminarías con duplicados con slugs nuevos al azar. Para cuentas grandes, usá la vía CSV y partí el archivo en tandas de hasta 2.000 filas, importándolas de a una. Además los imports tienen rate limit (unos pocos por IP cada algunos minutos), así que con calma.

## Dos cosas más para chequear

- **Los webhooks se disparan en el import.** Cada link importado es un link nuevo, así que si configuraste un webhook de `link.created`, se dispara una vez por link. Miles de eventos de golpe pueden sorprender a lo que esté escuchando. Pausá el webhook durante el import si te importa.
- **El equipo ve todo.** Los imports caen en tu workspace activo, así que todos los que estén ahí ven los links. Importá en el workspace correcto.

## Después de la mudanza

Una vez adentro, a tus links viejos les aplica todo lo de Link: editar destinos sin cambiar la URL corta, sumar contraseña, vencimiento o límite de clicks, bajar QR y mirar analytics sin cookies. Si querés el panorama completo de cómo se comparan Link y Bitly más allá del import, escribimos [una comparación honesta](/blog/zerosoft-link-vs-bitly), incluidos los casos en los que te conviene quedarte donde estás.

Y si resulta que Link no es para vos, el [export](/blog/exportar-tus-datos-deberia-ser-un-derecho) también está a un click: todos los links en CSV, o JSON con cada click. Entrar nunca debería ser más fácil que salir.
