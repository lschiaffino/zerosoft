---
title: "Seguir los precios de la competencia con un robot y un flow"
description: "Un robot que lee la página de precios de tus competidores todos los días, guarda el historial en una planilla y te avisa cuando algo cambia o cuando la página se rediseña. Paso a paso con Robots y Flow."
date: "2026-10-18"
author: "zerosoft"
tags: ["robots", "flow", "browse-ai"]
---

Browse AI publicó un buen caso de uso: [cómo automatizar el monitoreo de precios de competidores SaaS](https://www.browse.ai/blog/how-i-automated-saas-competitor-price-monitoring). Un robot que lee la página de precios, guarda los datos y avisa por Slack. La idea es correcta y vale para cualquier equipo chico que vende contra dos o tres rivales: enterarte de una suba de precio por un cliente que te lo cuenta en una llamada es enterarte tarde.

Este post arma lo mismo con Robots, la automatización de navegador de zerosoft, y Flow, nuestros flujos. Sin créditos por extracción: en tu servidor el robot corre en tu Chromium. Te mostramos los pasos exactos, qué decisiones conviene tomar y dónde Robots todavía se queda corto.

## Qué conviene vigilar

Antes de abrir la herramienta, hacé la lista. Por cada competidor, mirá su página de precios y anotá:

- **Nombre y precio de cada plan.** Lo obvio.
- **El selector de facturación.** Casi todas las páginas tienen un botón mensual/anual. El precio que se ve al cargar suele ser el anual. Decidí cuál querés leer y sé consistente.
- **Límites que importan para tu venta.** Usuarios incluidos, contactos, almacenamiento. Muchas subas de precio llegan como un límite que baja, con el precio igual.
- **El texto de la promoción**, si hay. Un "50% el primer año" cambia la comparación aunque la lista no se mueva.

Con tres competidores y cuatro datos cada uno ya tenés un tablero que nadie de tu equipo mantiene hoy.

## Paso 1: el robot

En Robots, empezá desde la plantilla **Revisar un precio todos los días**. Trae dos entradas, la URL del producto y el selector del precio, y un horario diario. Para una página de precios SaaS la ajustamos así:

1. **Ir a URL**: `{{inputs.url}}`, con la página de precios del competidor como valor de la entrada.
2. **Clic** con texto visible `Mensual` (o `Monthly`). Si no hay un selector estable, Robots busca el elemento por el texto que escribiste.
3. **Esperar** hasta que aparezca el selector de los precios. Las páginas que cargan precios con JavaScript necesitan este paso.
4. **Extraer** con el modo "Todos los resultados (lista)" sobre el selector de los nombres de plan, guardado como `planes`. Devuelve una lista con el texto de cada elemento, hasta 200.
5. **Extraer**, mismo modo, sobre el selector de los precios, guardado como `precios`.
6. **Captura**, con el nombre `pagina`. Queda guardada en la corrida, y una imagen de la página ese día vale para cuando alguien pregunte "¿desde cuándo cobran eso?".

Para encontrar selectores: clic derecho sobre el precio, Inspeccionar, Copiar selector, y después simplificalo hasta que quede algo legible como `.pricing-card .price`. Si preferís no tocar el inspector, el grabador de Robots es un bookmarklet: lo abrís en la página, hacés los clics a mano y te devuelve los pasos con selectores elegidos en orden de estabilidad (data-testid, id, name, aria-label, texto visible).

Si un elemento aparece solo a veces, como un banner de promoción, usá **Si existe el elemento** con "Saltear los pasos siguientes" antes del paso que extrae su texto: si el banner no está, el robot saltea ese paso y sigue.

Corré el robot a mano una vez. El panel de corridas muestra la captura y la salida en JSON, algo así:

```json
{
  "planes": ["Starter", "Pro", "Business"],
  "precios": ["$12", "$29", "$59"]
}
```

## Paso 2: el horario

En el robot, poné el horario en **Todos los días** a las 9:00 en tu zona horaria. También acepta intervalos (mínimo cada 15 minutos) o una expresión cron. Para precios, una vez por día es suficiente; nadie cambia su página de precios cada hora, y menos visitas también es más respetuoso con el sitio que leés.

Un robot por competidor es lo más simple de mantener: si uno rediseña su página, rompés un solo robot.

## Paso 3: el flow que guarda y avisa

Cada corrida que termina emite el evento `robot.run.finished`, con el nombre del robot y su salida. En Flow:

1. **Disparador: evento** `robot.run.finished`. En avanzado, filtrá por `robot.name` igual a "Precios: Competidor A".
2. **Google Sheets**, operación append, con una fila: `{{now}}`, `{{trigger.robot.name}}`, `{{trigger.output.planes | json}}`, `{{trigger.output.precios | json}}`. Esa es tu historia: una fila por día y por competidor.
3. **Si**: `{{trigger.output.precios | json}}` distinto de `["$12","$29","$59"]`, el último valor que conocés.
4. En la rama verdadera, **Slack** o **Email**: "Cambió la página de precios de Competidor A: {{trigger.output.precios | json}}".

Cuando llega un aviso, revisás, actualizás el valor del paso 3 y listo.

Un hueco honesto: Robots no compara una corrida con la anterior por su cuenta. La comparación la hace la condición del flow contra el valor que cargaste vos. Si querés que compare solo contra el día anterior, se puede con un paso de Google Sheets en modo lectura y un nodo de código que compare con la última fila, pero ya es un flow más largo.

## Paso 4: avisá también cuando el robot falla

Cuando una corrida falla se emite `robot.run.failed`, con el número de paso y el error. Armá un segundo flow chiquito que te mande un email con ese error.

Esto importa más de lo que parece. Si el selector deja de encontrar los precios, casi siempre es porque el competidor rediseñó la página de precios. Y un rediseño de la página de precios suele venir con un cambio de precios o de planes. El fallo es una señal en sí mismo.

## Qué hacer con los datos

El historial en la planilla responde preguntas concretas:

- **¿Cuándo cambió?** La primera fila con el valor nuevo. La captura de ese día lo confirma.
- **¿Qué cambió?** Precio, nombre de plan o cantidad de planes. Un plan que desaparece suele ser una consolidación hacia arriba.
- **¿Qué le decimos a ventas?** Una línea en el canal del equipo cuando cambia algo, con la captura. Si usás el CRM, es buen material para las notas de los deals donde ese competidor está en juego.

## Límites que conviene conocer

Los límites de una corrida están en el código: hasta 100 pasos, 20 páginas, 5 capturas y 180 segundos. Corre un robot a la vez por workspace, así que si tenés diez competidores, escalonalos: los que coinciden esperan la siguiente pasada del cron. En zerosoft Cloud se miden los minutos de navegador que usás; el código trae una cuota mensual por workspace configurable con `ROBOTS_FREE_MINUTES_PER_MONTH` (120 minutos por defecto). Un robot de precios tarda segundos por corrida.

Para comparar: el plan Free de Browse AI da [50 créditos por mes y monitoreo como mucho cada hora](https://www.browse.ai/pricing).

Lo que Robots todavía no hace, y que las herramientas pagas de scraping suelen incluir:

- **No se adapta solo** cuando la página cambia. Si el selector se rompe, lo arreglás vos (y el paso 4 te avisa).
- **No trae proxies ni geolocalización.** Si el competidor muestra precios distintos por país, el robot ve los del país de tu servidor.
- **No resuelve captchas.** Una página detrás de un captcha no la lee.
- **No hay robots armados** para sitios populares. Arrancás de una plantilla genérica.

## Un par de reglas de convivencia

Leé páginas públicas, una vez por día, y respetá los términos del sitio. Robots puede guardar la sesión entre corridas para páginas con login, pero una página de precios no la necesita, y es mejor así.

## En una tarjeta

- Un robot por competidor: ir a URL, clic en "Mensual", esperar, extraer planes y precios, captura.
- Horario diario. Más seguido no aporta.
- Flow en `robot.run.finished`: fila en la planilla, condición contra el último valor, aviso.
- Flow en `robot.run.failed`: un selector roto suele ser un rediseño.
