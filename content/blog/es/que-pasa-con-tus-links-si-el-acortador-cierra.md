---
title: "Qué pasa con tus links cortos si el acortador cierra"
description: "Lo que dejó el cierre de goo.gl y Firebase Dynamic Links, y un plan en cuatro pasos para que tus links cortos sobrevivan a cualquier proveedor: dominio propio, exportación, reimportación y self-host."
date: "2026-10-18"
author: "zerosoft"
tags: ["link", "dominios", "migración", "open source"]
---

En 2024 Google [anunció](https://developers.googleblog.com/en/google-url-shortener-links-will-no-longer-be-available/) que los links `goo.gl` iban a dejar de responder el 25 de agosto de 2025. Después de las quejas [dio marcha atrás a medias](https://ppc.land/google-changes-course-on-goo-gl-shutdown-preserves-actively-used-links/): conservó los links con actividad y apagó los que su propio criterio marcó como inactivos, un criterio que nunca publicó. El mismo día también terminó [Firebase Dynamic Links](https://firebase.google.com/support/dynamic-links-faq), el producto que Google había recomendado como reemplazo.

Fijate qué pasó con los dueños de esos links: nada que pudieran hacer. Un PDF de 2017, un video de YouTube con el link en la descripción, un folleto impreso. El destino seguía existiendo, la página seguía en pie, y el link igual se rompió porque el dominio del medio era de otra empresa.

Este post es un plan para que eso no te pase, con cualquier acortador. Al final contamos cómo lo cumple Link y qué parte todavía no.

## El problema real: de quién es el dominio

Un link corto tiene dos partes: el dominio (`goo.gl`, `bit.ly`, `go.tuempresa.com`) y el slug (`/promo`). Quien controla el DNS del dominio decide a dónde va cada visita. Si el dominio es del proveedor, el link es del proveedor, aunque lo hayas creado vos y aunque pagues todos los meses.

Con un dominio propio la situación se invierte. Si mañana cambiás de herramienta, apuntás el DNS a la nueva, cargás los mismos slugs y `go.tuempresa.com/promo` sigue funcionando. Nadie que tenga el link impreso se entera.

## El plan en cuatro pasos

### 1. Todo link que vaya a durar, en tu dominio

Usá el dominio del proveedor para lo descartable: un link que mandás por chat hoy y nadie va a abrir en un año. Todo lo demás (impresos, QR, documentos, firmas de email, descripciones de video, la bio de Instagram) va en un subdominio tuyo, como `go.` o `l.`.

En Link se configura en **Dominios**: agregás el host, cargás el registro DNS y Link lo verifica. Cada dominio tiene sus propios slugs, así que `go.tuempresa.com/promo` y `go.otramarca.com/promo` pueden ir a lugares distintos. El paso a paso de DNS está en [este post](/blog/dominios-propios-dns-paso-a-paso).

Un detalle que suele quedar afuera: la raíz. `go.tuempresa.com/` sin slug también recibe visitas (gente que borra el final del link para "ver qué hay"). En Dominios podés fijar a dónde va ese redirect de la raíz. Si no configurás nada, va a la home de zerosoft.

### 2. Una lista que puedas llevarte

Si el proveedor cierra, necesitás dos columnas por link: la URL corta y el destino. Sin eso, reconstruir cientos de links es arqueología.

El test es simple: ¿podés bajar esa lista hoy, completa, en un archivo que abra una planilla? En Link está en **Configuración**, en la sección **Exportar links**:

- **CSV de links:** `short_url, slug, domain, url, title, tags, clicks, archived, expires_at, max_clicks, created_at`. Una fila por link, todos los links del workspace.
- **JSON con clics:** los links más cada clic con fecha, referrer, país, dispositivo, navegador y sistema operativo, hasta los 100.000 clics más recientes.

Bajalo una vez por mes y guardalo con el resto de tus backups. Es un archivo chico.

### 3. Un lugar a donde mudarte

La lista sirve si otra herramienta la puede leer. El importador de Link (en **Importar**) acepta el CSV de Bitly, su API con un token, o el CSV de cualquier acortador: busca una columna de destino (`long`, `destination`, `original`, `target` o `url`), una de URL corta (`short`, `bitlink`, `link`), y opcionalmente título y tags.

Lo que importa es que conserva el slug. Si la URL corta era de un dominio que ya verificaste en Link, el link queda en ese dominio con el mismo slug, así que al mover el DNS sigue funcionando. Si el slug ya está tomado, te avisa cuál renombró. El límite es de 2.000 links y 5 MB por carga; para más, partí el archivo.

El CSV que exporta Link tiene `short_url` y `url`, así que el mismo archivo se puede importar en otra instancia de Link.

### 4. Un plan B que no dependa de nadie

El último escenario es el más incómodo: ¿y si el que cierra somos nosotros? Para eso existe la licencia. El código de Link es AGPLv3 y está en [GitHub](https://github.com/lschiaffino/zerosoft). Podés correrlo en un VPS con Docker ([guía](/blog/self-hosting-con-docker-paso-a-paso)), importar tu CSV y apuntar tu dominio. El resultado es el mismo producto con tu base de datos.

## Qué no viaja en una mudanza

Mejor saberlo antes. El import crea links nuevos con destino, slug, título y tags. Esto se queda atrás:

- **El historial de clics.** El JSON lo tiene, pero el importador no lo carga. Guardalo como archivo si lo necesitás para reportes.
- **Contraseñas, vencimientos y límites de clics.** Hay que volver a ponerlos en los links que los usaban. El CSV exportado trae `expires_at` y `max_clicks` para que sepas cuáles son; las contraseñas no se exportan.
- **Segmentación y tipo de redirect.** Los destinos por país o dispositivo, los A/B y el 301 se configuran de nuevo.
- **Los links en el dominio del proveedor.** Un `bit.ly/xyz` sigue siendo de Bitly. Podés importar el destino y crear un link nuevo en tu dominio, pero el link viejo va a seguir apuntando a donde Bitly decida.

## Un checklist de diez minutos

Hacelo con la herramienta que uses hoy, sea la nuestra o no:

1. ¿Cuántos de tus links impresos o en documentos usan el dominio del proveedor? Esos son tu riesgo.
2. ¿Tenés un subdominio propio configurado? Si no, es el primer paso, y lleva una tarde.
3. ¿Podés exportar todos los links con URL corta y destino? Probalo ahora y abrí el archivo.
4. ¿Hay al menos otra herramienta que pueda importar ese archivo conservando los slugs?
5. ¿El QR que imprimiste apunta a tu dominio? En Link, el QR codifica la URL corta del link (con `?qr=1` para contar escaneos aparte), así que si el link está en tu dominio el QR también.

Si contestaste que sí a las cinco, el cierre de un proveedor pasa a ser un trámite de una tarde. El post sobre [cómo pasar de Bitly a Link](/blog/migrar-de-bitly-a-link) tiene el detalle del importador si querés empezar por ahí.
