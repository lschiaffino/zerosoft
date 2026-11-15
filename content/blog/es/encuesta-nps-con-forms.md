---
title: "Encuesta NPS con Forms: plantilla, lógica y cómo leerla"
description: "Cómo armar una encuesta NPS en Forms con la plantilla incluida: pregunta de 0 a 10, seguimiento según el puntaje, campos ocultos y cómo se calcula el resultado."
date: "2026-11-15"
author: "zerosoft"
tags: ["forms", "typeform", "guía"]
---

Una encuesta NPS tiene una pregunta: qué tan probable es que recomiendes el producto, de 0 a 10. El número solo dice poco. Lo útil viene después, cuando preguntás el motivo y alguien del equipo lo lee.

Typeform tiene [una guía sobre NPS](https://www.typeform.com/guides/net-promoter-score) que explica la escala y recomienda cerrar con un "por qué". Acá va la versión para Forms, la app de formularios de zerosoft: qué trae la plantilla, cómo la ajustás y cómo leés el resultado sin una planilla aparte.

## La cuenta, con números

Las respuestas de 9 y 10 son promotores, las de 7 y 8 son pasivos, las de 0 a 6 son detractores. El NPS es el porcentaje de promotores menos el porcentaje de detractores. Va de -100 a 100.

Ejemplo inventado para ver la mecánica: 50 respuestas, 25 promotores, 15 pasivos y 10 detractores. Promotores 50%, detractores 20%, NPS 30. Los pasivos no suman ni restan, pero cuentan en el total.

Forms hace esta cuenta con esos mismos cortes y la muestra en la pestaña **Resumen**: el puntaje y cuántos promotores, pasivos y detractores hay. Se calcula sobre respuestas completas.

## Paso 1: empezá desde la plantilla

En Forms elegí **Nuevo formulario** y, en **Empezar desde**, la plantilla **Encuesta NPS**. Activá **Con lógica** si querés que venga con las reglas armadas. Ponele nombre, elegí el idioma del formulario y tocá **Crear formulario**.

La plantilla trae cuatro preguntas:

1. La pregunta del puntaje, obligatoria, en escala de 0 a 10 con los extremos "Poco probable" y "Muy probable".
2. Un texto largo para quien puso 6 o menos: "Lamentamos. ¿Qué deberíamos arreglar primero?"
3. Otro para quien puso 7 u 8: "¿Qué haría falta para que sea un 10?"
4. Otro para quien puso 9 o 10: "¡Genial! ¿Qué es lo que más te gusta?"

Al final hay un email opcional para poder escribirle a la persona. La lógica de la plantilla manda a cada uno a su pregunta de seguimiento y después todos convergen en el email.

## Paso 2: entendé la lógica para poder cambiarla

Abrí la pestaña **Lógica** del editor. Vas a ver reglas en la pregunta del puntaje, evaluadas en orden:

- Si el puntaje **es como máximo** 6, saltar a la pregunta para detractores.
- Si no, y el puntaje **es como máximo** 8, saltar a la de pasivos.
- Si no, siempre: saltar a la de promotores.

Los saltos van solo hacia adelante, así que el orden de las preguntas en la pestaña **Preguntas** importa: las tres de seguimiento tienen que estar después del puntaje.

Una variante que sirve a los equipos chicos: si solo te importa entender a los detractores, mandá a pasivos y promotores directo a un final de agradecimiento y ahorrales una pregunta. Con **Agregar regla** y la acción **saltar a** un final lo resolvés sin tocar código.

Si querés que la escala sea de NPS en una pregunta propia, en **Preguntas** elegí una escala de opinión y marcá **Net Promoter Score (0 a 10)**. Eso fija el rango de 0 a 10 y hace que el Resumen calcule el puntaje.

## Paso 3: sabé de dónde viene cada respuesta

Un NPS global esconde mucho. Para separar por plan, por canal o por campaña, usá **Campos ocultos**: nombres separados por comas que Forms lee del link. Si cargás `plan` y `origen`, mandás el link como `/f/tu-formulario?plan=pro&origen=email` y cada respuesta guarda esos valores junto a las contestaciones. También viajan en el webhook.

Una forma concreta de usarlo: en el email de seguimiento post-compra, armá el link con el plan de cada cliente. Después filtrás las respuestas y comparás.

## Paso 4: avisos y automatización

En **Ajustes** del formulario, **Notificaciones** te deja avisar dentro de zerosoft a personas del workspace, y mandar un email a hasta 10 direcciones. Alcanza para que soporte vea al instante cada respuesta nueva.

Si querés ir más lejos, cada respuesta dispara el evento `forms.response.submitted` en Flow, y el formulario puede tener un webhook firmado con el header `Zerosoft-Signature`. Un uso típico: un flow que, ante un puntaje de 6 o menos, cree una tarea de seguimiento para que alguien escriba al cliente esta semana.

## Paso 5: compartilo

En la pestaña **Compartir** tenés el link público, un iframe, un embed en línea que crece con el formulario y un botón con popup. También un código QR para imprimir. Podés cerrar el formulario por fecha o por cantidad de respuestas, útil si querés una encuesta con límite.

## Cómo leer el resultado

- Mirá los comentarios antes que el número. Tres detractores que dicen lo mismo valen más que un punto de NPS.
- Compará contra vos mismo, mes contra mes. Un NPS aislado no dice mucho sin referencia.
- Con pocas respuestas el puntaje salta mucho. Con 20 respuestas, un solo detractor mueve el resultado 5 puntos.
- Mirá el abandono por pregunta en el Resumen: si mucha gente se va en el texto largo, acortalo o hacelo opcional.

## Qué todavía no hace

Forms todavía no tiene pruebas A/B, etiquetas sobre las respuestas ni pagos dentro del formulario. No hay integración nativa con Google Sheets: para eso están el webhook y Flow. La API pública de Forms es de solo lectura. Tampoco hay un dominio propio para formularios.

## Costo

Self-host a $0 con AGPLv3, con todas las funciones de Forms. En zerosoft Cloud hay plan gratis para empezar y después pagás por uso; los asientos no se cobran, así que sumar a alguien de soporte para leer respuestas no cambia la factura. Más detalle en [Forms](/products/forms) y en la [alternativa a Typeform](/compare/typeform-alternative).
