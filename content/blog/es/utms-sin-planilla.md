---
title: "UTMs sin planilla: una convención para equipos chicos"
description: "Una convención de UTMs corta para un equipo chico, y cómo llevarla en Link con el constructor de UTM, tags, carga masiva, exportación CSV por link y comparación de 7, 30 y 90 días."
date: "2026-09-03"
author: "zerosoft"
tags: ["link", "utm", "marketing"]
---

Todo equipo chico tiene la misma planilla. Se llama algo como `UTMs FINAL v3`, tiene una pestaña por trimestre, la mitad de las filas dice `Facebook` y la otra mitad `facebook`, y la única persona que la entiende está de vacaciones.

La planilla existe porque los UTMs necesitan dos cosas que nadie hace cumplir: una convención de nombres y un único lugar donde se crean los links. Este post te da una convención lo bastante corta para acordártela y muestra cómo llevarla dentro de Link, para que ese "único lugar" sea la herramienta que ya usás para acortar links.

## Primero: para qué sirven los UTMs (y para qué no)

Los parámetros UTM son para **las analytics de tu sitio**: GA, Plausible, Matomo, lo que sea que lea `utm_source`, `utm_medium` y `utm_campaign` de la URL de llegada y agrupe las visitas.

Las analytics de Link no necesitan UTMs. Cada link corto ya cuenta sus clicks por día, referrer, país, dispositivo, browser y OS, [sin cookies](/blog/analytics-sin-cookies). Así que tenés dos vistas que se complementan: Link te dice cuánta gente hizo click en cada link; las analytics de tu sitio te dicen qué hizo esa gente después de llegar. Los UTMs son el pegamento entre las dos.

## La convención: tres campos, minúsculas, sin excepciones

Esta convención entra en un post-it. Adaptá el vocabulario, pero respetá las reglas.

**`utm_source`: quién mandó el tráfico.** La plataforma o propiedad concreta: `newsletter`, `linkedin`, `instagram`, `youtube`, `partner-acme`.

**`utm_medium`: qué tipo de canal.** Una lista corta y cerrada: `email`, `social`, `paid-social`, `cpc`, `referral`, `print`. Si estás por inventar un medium nuevo, probablemente querías un source nuevo.

**`utm_campaign`: qué estás empujando, con fecha.** `2026-09-lanzamiento`, `2026-10-webinar-precios`. El prefijo de fecha los ordena y elimina la pregunta "¿cuál lanzamiento?".

Y las reglas:

1. **Todo en minúsculas.** La mayoría de las herramientas de analytics trata `LinkedIn` y `linkedin` como dos sources distintos. Link guarda exactamente lo que escribís, así que la disciplina es tuya.
2. **Guiones, no espacios.** Los espacios se vuelven `%20` o `+` y nadie quiere leer eso en un reporte.
3. **Nada de texto libre.** Si un valor no está en la lista, primero se agrega a la lista. La lista vive en el doc que tu equipo ya lee, no en una planilla de links.

¿Necesitás `utm_content` o `utm_term` para variantes A/B? El builder de Link solo tiene campos para source, medium y campaign, pero nada te impide escribir `?utm_content=variante-b` en la URL de destino a mano. El builder suma sus tres parámetros encima sin tocar los que ya estaban.

## Crear un link con el builder

En **Nuevo link**, pegá el destino y abrí el **UTM builder**. Completá source, medium y campaign; la vista previa de la **URL final** te muestra exactamente cómo va a quedar el destino. Después:

- **Título:** algo que un humano pueda leer en una lista. "Lanzamiento sept: post LinkedIn".
- **Tags:** el nombre de la campaña, por ejemplo `2026-09-lanzamiento`. Hasta cinco tags por link, así que podés sumar el canal o el responsable.
- **Slug custom** si el link va a algún lugar donde la gente lo va a tipear, como una slide o un podcast.

Los UTMs quedan incorporados en el destino cuando se crea el link. Si después necesitás cambiarlos, editá la URL de destino: el link corto sigue siendo el mismo, que es lo que importa si ya anda dando vueltas.

## Masivo: una campaña, muchos links

Los lanzamientos casi nunca necesitan un solo link. Un newsletter tiene ocho, un kit para partners tiene veinte. La **Creación masiva** acepta hasta 200 URLs, una por línea, y les aplica un **tag común** y un **UTM común** a todas.

Entonces, para el newsletter de septiembre: pegá los ocho destinos, tag `2026-09-lanzamiento`, source `newsletter`, medium `email`, campaign `2026-09-lanzamiento`. Un click, ocho links con UTMs idénticos y bien escritos. Tocá **Descargar CSV** para tener `original_url,short_url,status` de cada línea, y pegá los links cortos en tu herramienta de email.

Dos cosas a saber del masivo: los links salen con slug al azar y sin título (agregale título después a los que te importen), y se crean en el dominio por defecto. Si los querés en tu [dominio propio](/blog/dominios-propios-dns-paso-a-paso), crealos de a uno o por la API, que acepta un campo `domain`.

## Encontrar cosas: los tags son tus carpetas de campaña

En la lista de links, tocá un chip de tag para filtrar: todos los links de `2026-09-lanzamiento`, los más nuevos primero, u ordenados por **Más clickeados**. El buscador matchea slug, destino y título, así que buscar `utm_source=linkedin` te encuentra todos los links de LinkedIn, porque los UTMs son parte del destino.

Esa es la recompensa de la convención: nunca más preguntás "¿dónde está el link de X?". Filtrás.

## Leer resultados: 7, 30, 90 días y contra el período anterior

Abrí cualquier link y elegí un rango: 7 días, 30 días o 90 días (o todo el historial). Al lado del total del rango vas a ver la comparación contra el **período anterior del mismo largo**, con un porcentaje para arriba o para abajo. "30 días, ↑ 40% vs anterior" responde "¿este link evergreen sigue funcionando?" sin hacer cuentas.

Una rutina de diez minutos por semana:

- Filtrá por el tag de la campaña actual, ordená por **Más clickeados**.
- Abrí los tres de arriba y los tres de abajo; mirá la comparación de 7 días.
- Cruzá con las analytics de tu sitio usando el mismo valor de campaign. Clicks en Link contra sesiones en tu sitio te dicen dónde se pierde la gente entre el click y la llegada.

## Cuando sí necesitás los datos crudos

A veces alguien quiere números para un reporte. Dos exports lo cubren:

- **CSV por link:** en el log de clicks de un link, **Exportar CSV** baja cada click del rango elegido (opcionalmente filtrado por país) con `timestamp,country,referrer,device,browser,os`. Ideal para "mostrame exactamente cuándo se compartió esto".
- **Todo:** el export de datos en la configuración baja todos los links en CSV (con tags separados por `|` y clicks totales) o en JSON con cada click. Ese es tu consolidado por campaña si tu jefe insiste con la tabla dinámica.

Un hueco honesto: no hay un dashboard por campaña que sume todos los links de un tag por vos. Las analytics son por link, más los totales y top links del overview. Si necesitás el consolidado por tag, el export (o `GET /api/v1/links/:id/stats` desde un script) te lo resuelve en pocas líneas.

## Todo en una tarjeta

- Source = plataforma, medium = lista cerrada, campaign = `aaaa-mm-nombre`. Minúsculas, guiones.
- Un tag por campaña, igual al valor de campaign.
- ¿Muchos links? Creación masiva con tag y UTM comunes.
- Revisión semanal: filtrar por tag, ordenar por clicks, mirar la flecha contra el período anterior.
- Exportar solo cuando un humano pide una planilla.

La planilla se puede jubilar. Se lo ganó.
