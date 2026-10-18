---
title: "Un centro de ayuda para tus clientes con Docs"
description: "Cómo armar con Docs un centro de ayuda público: colecciones, artículos que se encuentran con la búsqueda, el voto de ¿Te sirvió?, la pestaña Ayuda del widget de Chat y las respuestas de la IA. Con los límites a la vista."
date: "2026-10-18"
author: "zerosoft"
tags: ["docs", "chat", "playbook"]
---

Notion tiene una guía para [armar un centro de ayuda en Notion](https://www.notion.com/help/guides/how-to-build-a-help-center-in-notion): partís de una plantilla, sumás artículos como subpáginas, les das formato con callouts y publicás la página en la web. Funciona, y el resultado es una página de Notion pública.

Un centro de ayuda necesita algo más que páginas públicas. El cliente tiene que encontrar la respuesta antes de escribirle a soporte, el equipo tiene que saber qué artículos no sirven y la misma información tiene que llegar al chat. Docs tiene un centro de ayuda propio que hace esas tres cosas, y este post explica cómo armarlo.

## Qué es el centro de ayuda de Docs

Cada workspace tiene un centro de ayuda en `zerosoft.ai/h/<tu-handle>`, o en el dominio de tu instalación si lo hosteás vos. Ahí aparecen solo las páginas de Docs que publicaste. Las demás siguen siendo internas.

Lo que trae:

- **Portada** con un buscador ("¿En qué te ayudamos?") y tus colecciones con la cantidad de artículos.
- **Artículos** en solo lectura, con la ruta de la colección, la fecha de última actualización, un índice "En esta página" armado con los títulos del artículo, y anterior y siguiente dentro de la colección.
- **"¿Te sirvió este artículo?"** al pie, con un voto por visitante y por artículo.
- **Metadatos** para buscadores y redes: el título del artículo con el nombre del workspace, y el primer párrafo como descripción.
- El **color de tu widget de Chat** como acento, para que el centro de ayuda y el chat se vean de la misma marca.

## Paso 0: el handle

El centro de ayuda usa el mismo handle que tus páginas de reserva de Cal. Si todavía no lo configuraste, el panel Compartir te avisa: "Configurá tu handle en Calendario para tener centro de ayuda". Elegí uno corto y con el nombre de la empresa, porque va a estar en todos los links que mandes a clientes.

## Paso 1: las colecciones

Docs arma la estructura a partir del árbol de páginas, con una regla: **una página publicada cuyo padre no está publicado es una colección**, y las páginas publicadas que cuelgan de ella son sus artículos.

En la práctica, el árbol queda así:

- **Centro de ayuda** (sin publicar: es solo una carpeta interna)
  - **Primeros pasos** (publicada: colección)
    - Crear tu cuenta
    - Invitar a tu equipo
  - **Facturación** (publicada: colección)
    - Cambiar el medio de pago
    - Descargar una factura
  - **Problemas frecuentes** (publicada: colección)

Cinco o seis colecciones alcanzan para empezar. La primera línea de cada colección es su descripción en la portada, así que escribí una frase que diga qué hay adentro: "Cómo pagar, cambiar de plan y pedir facturas".

Los artículos salen en el orden del árbol, así que crealos en el orden en que querés que se lean.

## Paso 2: artículos que se encuentran

El buscador del centro de ayuda busca en el título y en todo el texto de cada artículo publicado, y tolera variantes de una misma palabra: "reembolso" encuentra "reembolsos" y "factura" encuentra "facturación". Igual conviene ayudarlo:

- **Titulá con la pregunta del cliente.** "Cambiar el medio de pago" le gana a "Gestión de cobros".
- **Respondé antes del primer título.** El texto que va antes del primer título es el resumen que aparece en la búsqueda, en la colección y en Google (se corta a 160 caracteres).
- **Usá títulos dentro del artículo.** Con dos o más, el artículo muestra el índice "En esta página".
- **Un artículo, una tarea.** Si un artículo responde tres preguntas, son tres artículos.

Una plantilla que funciona para casi todo:

```
[Respuesta en una o dos frases.]

## Paso a paso
1. ...
2. ...

## Si no funciona
- Causa frecuente y cómo resolverla.

## Relacionado
- Link público a otro artículo
```

Lo que el editor de Docs tiene hoy: títulos, listas, to-dos, citas, bloques de código, tablas y divisores. Lo que falta para un centro de ayuda: imágenes dentro del texto, callouts y videos embebidos. Si un paso necesita una captura, por ahora describilo con palabras exactas de la interfaz ("tocá **Compartir**, después **Publicar en el centro de ayuda**").

## Paso 3: publicar

Abrí la página, tocá **Compartir** y activá **Publicar en el centro de ayuda**. Desde ahí también copiás el link público. Cada página se publica por separado: publicar una colección no publica sus hijas, así que podés tener borradores dentro de una colección pública.

El link de cada artículo se arma con su título la primera vez que lo publicás y después no cambia, aunque edites el título. Los links que ya mandaste a clientes siguen funcionando.

## Paso 4: que el chat lo use

Acá está la diferencia con una página pública suelta. Si usás Chat:

- **Pestaña Ayuda del widget.** En la configuración del widget, activá **Mostrar pestaña de ayuda**. El widget suma una pestaña con tus artículos publicados y los sugiere mientras el visitante escribe su pregunta. Si el artículo responde, la conversación no hace falta.
- **Respuestas del bot.** El bot de respuesta automática y los agentes del Chat usan tus páginas publicadas para contestar. También podés darles páginas internas sin publicarlas: en Compartir, activá **La IA puede usarla**. Sirve para respuestas que tu equipo quiere usar en el chat sin mostrarlas en el centro de ayuda.

Con IA configurada, el modelo lee las páginas que encuentra. Sin IA, el bot responde con un extracto de la página que mejor coincide. En los dos casos, los artículos cortos y bien titulados del paso 2 dan mejores respuestas.

Escribimos aparte cómo [armar SLAs de soporte con Chat](/blog/slas-de-soporte-con-chat), y se complementa con esto: cada pregunta que responde el centro de ayuda es una conversación menos en la cola.

## Paso 5: mantenerlo vivo

Un centro de ayuda envejece rápido. Tres hábitos:

1. **Mirá los votos.** En el panel Compartir de cada artículo publicado ves cuántas personas dijeron que les sirvió y cuántas que no. Un artículo con más "no" que "sí" se reescribe esa semana.
2. **Escribí desde el chat.** Cuando una pregunta llega tres veces por Chat, se convierte en artículo. Usá las palabras del cliente en el título.
3. **Revisá en cada cambio de producto.** Docs guarda el historial de versiones de cada página (una automática como mucho cada 5 minutos mientras editás, más las que guardás a mano, hasta 50), así que podés reescribir sin miedo y volver atrás si hace falta.

## Lo que todavía no hace

Para que decidas con todo a la vista:

- **Dominio propio.** En zerosoft Cloud el centro de ayuda vive bajo `zerosoft.ai/h/`. No hay `ayuda.tuempresa.com` todavía.
- **Imágenes, callouts y videos** dentro de los artículos.
- **Varios idiomas** para el mismo artículo. Podés tener colecciones separadas por idioma, pero sin un selector.
- **Analítica de búsquedas**: no ves qué buscaron los visitantes sin encontrar nada.

Si lo que necesitás es un sitio de documentación con diseño propio, Notion publicado o una herramienta de docs dedicada te va a dar más control. Si lo que necesitás es que tus clientes encuentren respuestas y que tu chat conteste con la misma información, el centro de ayuda de Docs ya lo hace, en tu servidor por $0 o en zerosoft Cloud.
