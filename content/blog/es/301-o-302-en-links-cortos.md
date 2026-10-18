---
title: "301 o 302 en un link corto: qué cambia de verdad"
description: "Qué significan los redirects 301, 302, 307 y 308, qué hace Google con cada uno, por qué el caché del navegador importa más que el SEO en un link corto y qué hace Link cuando elegís 301."
date: "2026-10-18"
author: "zerosoft"
tags: ["link", "seo", "redirects"]
---

En el formulario de un link nuevo, dentro de las opciones avanzadas, hay un campo que casi nadie toca: **Tipo de redirect**, con dos valores, `301 Permanente` y `302 Temporal`. La pregunta de siempre es cuál conviene para el SEO. La respuesta corta para un link corto: casi ninguna diferencia en buscadores, y una diferencia grande en el navegador de la gente. Este post explica las dos cosas y muestra qué hace Link con cada opción, leído del código del redirect.

## Los cuatro códigos en una tabla

Un redirect es una respuesta HTTP que dice "lo que buscás está en otra URL". La especificación ([RFC 9110, sección 15.4](https://www.rfc-editor.org/rfc/rfc9110#section-15.4)) define varios. Los que importan son cuatro:

| Código | Significado | ¿Puede cambiar POST a GET? |
|---|---|---|
| 301 | Movido de forma permanente | Sí, por razones históricas |
| 302 | Encontrado en otro lado, por ahora | Sí, por razones históricas |
| 307 | Temporal, conservando el método | No |
| 308 | Permanente, conservando el método | No |

La columna del método importa para formularios y APIs. Un link corto siempre se abre con GET (alguien hace clic o escanea un QR), así que en la práctica 307 se comporta como 302 y 308 como 301. Quedan dos preguntas: permanente o temporal.

## Qué hace Google con cada uno

La documentación de Google sobre [redirects y búsqueda](https://developers.google.com/search/docs/crawling-indexing/301-redirects) lo dice sin vueltas: con un redirect permanente, Google muestra el destino en los resultados y lo toma como señal fuerte de que el destino es la URL canónica. Con uno temporal, puede seguir mostrando la URL de origen.

Para una página que se mudó (tu blog pasó de `/novedades/` a `/blog/`) eso importa mucho: querés que la URL nueva herede el lugar de la vieja, y ahí va un 301 en tu servidor web.

Para un link corto importa poco. Nadie quiere que `go.tuempresa.com/promo` aparezca en Google; lo que se indexa es tu página, a la que Google llega por tu sitio, tu sitemap y los links que apuntan a ella. El link corto vive en un post de LinkedIn, en un PDF o impreso en una caja.

## Lo que sí cambia: el caché del navegador

Un 301 sin instrucciones de caché es cacheable por defecto ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.2)). Los navegadores lo aprovechan: la segunda vez que alguien abre el mismo link corto, el navegador puede saltar directo al destino sin preguntarle al servidor.

En un sitio web eso ahorra un viaje. En un acortador rompe casi todo lo que hace útil al acortador:

- **El clic no se cuenta**, porque el pedido nunca llega.
- **Cambiar el destino no aplica** para quien ya lo tenía en caché. Corregís un typo en la URL y una parte de tu audiencia sigue yendo a la página rota.
- **Vencer o archivar el link no aplica**. El link con fecha de vencimiento sigue redirigiendo en ese navegador.
- **El límite de clics y la contraseña** dependen de que el servidor vea cada visita.

Por eso la recomendación habitual es "usá 302 en links cortos". Es correcta, pero el motivo real es el caché, y el caché lo decide un header, `Cache-Control`, más que el número del código.

## Qué hace Link

Abrimos el handler del redirect (`app/r/[slug]/route.ts`) para contarlo exacto:

1. **302 es el valor por defecto.** La columna `redirect_type` de cada link arranca en 302.
2. **Toda respuesta de redirect lleva `Cache-Control: no-store`, también la de 301.** El navegador no guarda el redirect, así que cada visita vuelve a pasar por el servidor: se cuenta el clic, se respeta el vencimiento, el límite, la contraseña y el destino actual. Elegir 301 en Link no te deja con links trabados.
3. **Bots y generadores de vista previa reciben siempre 302.** Googlebot, Bingbot, Slack, WhatsApp, LinkedIn y compañía se detectan por el User-Agent. No cuentan como clic y se los redirige con 302 sin importar lo que elegiste. Si el link tiene título, descripción o imagen de vista previa propios, reciben una página con esas etiquetas.
4. **Los links con segmentación siempre usan 302.** Si un link manda a destinos distintos por país, por dispositivo o con un A/B, un 301 diría "este es el destino permanente" cuando el destino depende de quién pregunta.
5. **La raíz de un dominio propio usa 302.** `go.tuempresa.com/` sin slug va a la URL que configures en Dominios, con un redirect temporal.

La consecuencia práctica, dicha de forma honesta: en Link, elegir 301 solo cambia el código que ven los navegadores de personas. Los buscadores ven 302 igual, y el caché está apagado en los dos casos. Dejamos la opción porque hay herramientas y auditorías que piden un 301 explícito, y porque algunos equipos lo prefieren para links que no van a cambiar nunca.

## Cómo verlo con tus propios ojos

`curl` cuenta como bot para Link (está en la lista de User-Agents que no son visitas), así que esto devuelve 302 siempre y no suma clics:

```bash
curl -sI https://go.tuempresa.com/promo
```

Para ver lo que recibe un navegador, mandá un User-Agent de navegador. Esta vez sí cuenta un clic:

```bash
curl -sI -A "Mozilla/5.0" https://go.tuempresa.com/promo
```

En la respuesta vas a ver `HTTP/2 301` o `302` según lo que elegiste, `location:` con el destino y `cache-control: no-store`.

## Una guía para decidir

| Situación | Qué usar |
|---|---|
| Link de campaña, newsletter, bio, QR impreso | 302 (el default de Link) |
| Link que puede cambiar de destino o vencer | 302 |
| Link con segmentación por país, dispositivo o A/B | 302 (Link lo fuerza) |
| Te piden un 301 por política interna o auditoría | 301 en Link: no se cachea, así que no perdés nada |
| Mudaste una página o un dominio y querés conservar el ranking | 301 en tu servidor web, sin acortador en el medio |

El último caso es el que más se confunde. Si cambiaste `tuempresa.com/precios-2025` por `tuempresa.com/precios`, el redirect tiene que vivir donde vive la página. En nginx, por ejemplo:

```nginx
location = /precios-2025 { return 301 /precios; }
```

Un acortador en el medio agrega un salto y un dominio más a la cadena, que es justo lo que querés evitar en una migración de SEO.

## Resumen

- Para buscadores, permanente contra temporal decide qué URL se muestra. En un link corto eso casi nunca importa.
- Para personas, lo que importa es si el navegador guarda el redirect. Un 301 cacheado deja de contar clics y de respetar cambios.
- Link manda `no-store` siempre, usa 302 por defecto y para bots, y fuerza 302 en links segmentados. Si elegís 301, solo cambia el número.
- Las mudanzas de páginas se resuelven con un 301 en tu propio servidor.

Si querés ver el resto de las opciones del formulario avanzado, el post sobre [contraseña, vencimiento y límite de clics](/blog/links-con-password-vencimiento-y-limite) cuenta cuándo usar cada una.
