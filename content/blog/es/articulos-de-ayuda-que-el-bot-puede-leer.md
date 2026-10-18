---
title: "Artículos de ayuda para dos lectores: tu cliente y tu bot"
description: "Cómo escribir artículos de centro de ayuda que respondan en las primeras líneas, se encuentren con las palabras del cliente y le sirvan al bot de Chat, con el centro de ayuda que sale de las páginas publicadas de Docs."
date: "2026-10-18"
author: "zerosoft"
tags: ["chat", "docs", "soporte", "centro de ayuda"]
---

Un artículo de ayuda hoy tiene dos lectores. Uno es la persona que llegó frustrada desde Google o desde el widget. El otro es el bot, que lee el mismo texto para contestar en el chat. Si el artículo le sirve a uno solo, perdiste la mitad del trabajo.

Intercom tiene un post clásico con [siete pasos para escribir mejor contenido de ayuda](https://www.intercom.com/blog/creating-better-help-content/): definir para qué sirve cada artículo, ponerse en el lugar de quien llega con un problema, mostrar además de contar, pensar en la búsqueda y hacerlo fácil de escanear. Todo eso sigue vigente. Lo que agregamos acá es la parte mecánica: cómo lee un artículo el bot de Chat, qué partes del texto pesan más y cómo eso cambia la manera de escribir.

## Cómo se arma el centro de ayuda

En zerosoft el centro de ayuda sale de Docs. No hay un editor aparte.

1. Escribís una página en Docs.
2. En **Compartir**, activás **Publicar en el centro de ayuda**. La página queda en `/h/<tu-handle>/<slug>`, legible para cualquiera sin cuenta. El handle es el mismo de tus páginas de reserva de Cal; si no tenés uno, Docs te pide configurarlo.
3. Las páginas publicadas cuyo padre no está publicado son colecciones; sus hijas publicadas son los artículos de esa colección.
4. En el widget de Chat, activás **Mostrar pestaña de ayuda**. El widget suma una pestaña con tus artículos y los sugiere mientras el visitante escribe la pregunta.

Hay un segundo interruptor en el mismo diálogo, dentro de Avanzado: **La IA puede usarla**. Sirve para páginas que querés que el bot conozca sin publicarlas, como una política interna de reembolsos. El bot lee las páginas publicadas y las que tienen ese interruptor activado. El resto del workspace queda afuera.

## Cómo lee el bot

Esto sale del código (`lib/chat-bot-ai.ts`, `lib/knowledge-search.ts` y `lib/chat-data.ts`). En la configuración del widget elegís de dónde responde el bot. Los dos modos que leen Docs funcionan así.

**AI (Docs + respuestas guardadas)**, si configuraste una clave del AI Gateway: cada página se corta en trozos de unos 900 caracteres, respetando las oraciones. Ante cada mensaje del visitante, una búsqueda BM25 elige los cinco trozos más relevantes entre tus páginas y tus respuestas guardadas, y el título de la página cuenta doble. El modelo tiene instrucciones de responder solo con ese material y, si no alcanza, derivar a una persona: la conversación sube a prioridad alta y el equipo recibe un aviso.

**Páginas de docs**, o el modo AI cuando el modelo falla: el bot compara las palabras del visitante con el título y el texto de cada página (una palabra en el título vale 2 puntos, en el cuerpo vale 1) y responde una sola vez con el título del artículo ganador seguido de sus primeros 280 caracteres.

De esos dos párrafos salen casi todas las reglas de abajo.

## Seis reglas para escribir

### 1. El título es la pregunta que escribe el cliente

"Facturación" no lo escribe nadie en un chat. "Cómo cambio la tarjeta de pago" sí. El título pesa doble en el bot, en la búsqueda del centro de ayuda y en las sugerencias del widget. Usá el verbo y el objeto que usaría el cliente.

### 2. La respuesta va en los primeros 280 caracteres

Es lo que manda el bot en modo Páginas de docs, y es lo que lee primero cualquier persona apurada. Nada de "En este artículo vas a aprender". Arrancá con la respuesta y después explicá.

> Mal: "La facturación es una parte importante de tu cuenta. En este artículo repasamos..."
> Bien: "Para cambiar la tarjeta, entrá en Configuración, Facturación, Método de pago y tocá Reemplazar. El cambio vale desde el próximo cobro."

### 3. Una pregunta por artículo

Un artículo de 4.000 caracteres se parte en cinco trozos, y el bot recibe solo los más parecidos a la pregunta. Si mezclás cambiar la tarjeta, pedir una factura y cancelar la cuenta, cada trozo arrastra ruido de los otros temas. Tres artículos cortos rinden más que uno largo.

### 4. Cada sección se entiende sola

Como el bot puede recibir el tercer trozo sin el primero, evitá "como dijimos arriba" o "esto" refiriéndose a algo de tres párrafos antes. Repetí el sustantivo: "el método de pago", no "eso".

### 5. Escribí también lo que no se puede

El bot no responde lo que no está escrito; deriva. Si un cliente pregunta "¿puedo pagar con transferencia?" y la respuesta es no, escribilo: "Por ahora aceptamos tarjeta de crédito y débito. No aceptamos transferencia bancaria." Una línea así resuelve la consulta en el chat y evita una derivación.

### 6. Pasos numerados con los nombres exactos de los botones

Si el botón dice "Reemplazar", el artículo dice "Reemplazar", no "cambiar" ni "actualizar". Coincide con lo que la persona ve en pantalla y con lo que busca.

## Una plantilla

```
Título: Cómo [verbo] [objeto] (las palabras del cliente)

[La respuesta en una o dos oraciones. Menos de 280 caracteres.]

## Pasos
1. Entrá en [menú exacto].
2. Tocá [botón exacto].
3. [Qué vas a ver cuando funcionó.]

## Si no te aparece [la opción]
[La causa más común y qué hacer.]

## Qué no se puede hacer
[Límites, en frases directas.]

Otras formas de decirlo: [sinónimos que usan tus clientes: factura, comprobante, recibo]
```

La última línea es para la búsqueda. El modo Páginas de docs busca coincidencias de palabras y el modo AI elige los trozos con una búsqueda léxica, así que un sinónimo que no aparece en el texto no existe para ninguna de las dos.

## Mantenerlo vivo

Cada artículo publicado tiene al pie "¿Te sirvió este artículo?". El conteo de sí y no aparece en el diálogo de Compartir de la página. Un artículo con muchos "no" muchas veces falla en la regla 2: la respuesta está, pero enterrada.

La otra fuente es el inbox. Cada vez que el bot deriva, deja un mensaje interno en la conversación. Una vez por semana, leé las derivaciones: si tres personas preguntaron lo mismo y el bot no supo, ahí tenés tu próximo artículo.

## Lo que todavía no hace

- No hay un reporte de búsquedas sin resultado en el centro de ayuda.
- El centro de ayuda no maneja traducciones: cada artículo está en el idioma en que lo escribiste.
- El bot lee hasta las 200 páginas modificadas más recientemente (100 en el modo Páginas de docs). Un workspace con mil páginas publicadas deja afuera las más viejas.

El centro de ayuda y el bot vienen con Docs y Chat, por $0 en tu servidor o en zerosoft Cloud.
