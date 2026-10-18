---
title: "Lead scoring con reglas: diez reglas que podés explicar en una reunión"
description: "Cómo armar un lead scoring para un equipo chico con reglas de propiedades y de actividad reciente, calibrarlo contra deals que ya ganaste o perdiste y convertir el score en tareas con workflows."
date: "2026-10-18"
author: "zerosoft"
tags: ["crm", "ventas", "lead scoring", "playbook"]
---

Tenés 300 contactos abiertos y tiempo para llamar a quince. El lead scoring responde una sola pregunta: a cuáles primero. Todo lo demás (modelos, pesos, predicciones) es una forma más o menos cara de contestar eso.

La [guía de lead scoring de HubSpot](https://blog.hubspot.com/marketing/lead-scoring-instructions) repasa siete modelos, desde el ajuste por cargo y empresa hasta el scoring predictivo con regresión logística. Para un equipo que cierra 40 deals por año, un modelo predictivo no tiene de dónde aprender: los datos no alcanzan. Lo que sí funciona con poco volumen es un puñado de reglas que cualquiera del equipo puede leer y discutir. Este post arma esas reglas en el CRM de zerosoft, las prueba contra tu historial y las conecta con trabajo concreto.

## Cómo calcula el score el CRM

Antes de diseñar reglas conviene saber exactamente qué hace el motor. Esto sale del código (`lib/crm-scoring-schema.ts`):

- **Reglas de propiedad.** Comparan un campo del contacto: etapa del ciclo de vida, estado del lead, origen, cargo, email, teléfono, ciudad, país, sitio web o cualquier campo personalizado. Operadores: igual, distinto, contiene, mayor que, menor que, tiene valor, está vacío. Las comparaciones ignoran mayúsculas.
- **Reglas de actividad.** Cuentan algo que pasó en los últimos N días (de 1 a 365): emails abiertos, clicks, respuestas, reuniones agendadas, formularios enviados, llamadas o notas registradas. Cada regla tiene un mínimo de ocurrencias.
- **Cada regla suma una vez.** Si se cumple, suma sus puntos (entre -1000 y 1000); si no, cero. Tres respuestas no valen el triple que una. Si querés premiar la intensidad, armá dos reglas: una con mínimo 1 y otra con mínimo 3.
- **Se recalcula solo.** Con cada evento relevante (un email abierto, una reunión, un formulario) y una vez por día desde el cron, así las ventanas de "últimos 30 días" vencen sin que nadie toque nada.
- **Se explica.** La ficha del contacto muestra qué reglas sumaron y cuánto. El score es una columna que podés ordenar y usar en el filtro avanzado.

## Paso 1: separá ajuste de interés

Un contacto puede ser el cliente ideal y no tener ningún apuro, o estar muy activo y no tener presupuesto. Si mezclás las dos cosas sin nombrarlas, un 40 no te dice cuál de los dos casos tenés delante.

El CRM guarda un solo score por contacto, así que la separación va en los nombres: cada regla empieza con "Ajuste:" o "Interés:". El desglose de la ficha queda legible de un vistazo.

## Paso 2: diez reglas para arrancar

Un punto de partida para un equipo que vende software a empresas chicas. Los puntos son un ejemplo; los vas a corregir en el paso 3.

| # | Regla | Tipo | Condición | Puntos |
|---|---|---|---|---|
| 1 | Ajuste: decide | Propiedad | Cargo contiene "founder" | +15 |
| 2 | Ajuste: tamaño | Propiedad | `custom.empleados` mayor que 10 | +10 |
| 3 | Ajuste: mercado | Propiedad | País igual al que atendés | +10 |
| 4 | Ajuste: email personal | Propiedad | Email contiene "@gmail." | -10 |
| 5 | Interés: formulario | Actividad | 1 formulario en 30 días | +20 |
| 6 | Interés: reunión | Actividad | 1 reunión agendada en 30 días | +30 |
| 7 | Interés: respondió | Actividad | 1 respuesta en 14 días | +25 |
| 8 | Interés: click | Actividad | 1 click en 14 días | +10 |
| 9 | Interés: aperturas | Actividad | 3 aperturas en 14 días | +5 |
| 10 | Descartado | Propiedad | Estado del lead igual a "unqualified" | -50 |

Tres decisiones detrás de la tabla:

- **Las aperturas valen poco.** Apple Mail precarga las imágenes de los emails para proteger la privacidad, y eso registra aperturas que nadie hizo. Un click o una respuesta son señales mucho más firmes.
- **El tamaño de empresa vive en el contacto.** Las reglas leen campos del contacto, no de la empresa. Si el dato te importa, pedilo en el formulario y guardalo en un campo personalizado del contacto (los formularios del CRM mapean a campos personalizados).
- **Una regla negativa fuerte para cerrar la puerta.** Cuando alguien marca un lead como no calificado, tiene que caer al fondo de la lista aunque abra todos tus emails.

Cargalas en **CRM → Configuración → Lead scoring**.

## Paso 3: calibrá contra lo que ya pasó

Un score sirve si los contactos que terminaron comprando quedan arriba. Probalo antes de confiar en él:

1. Armá una lista con los contactos de tus últimos 20 deals ganados y otra con los de 20 perdidos.
2. Ordená cada lista por score.
3. Mirá la mediana de cada una. Si los ganados no están claramente por encima, alguna regla está midiendo ruido.
4. Abrí la ficha de los casos raros (un perdido con 70, un ganado con 5) y leé el desglose. Muchas veces aparece una regla que suma por algo que no predice nada.

Una limitación honesta: las reglas de actividad miran los últimos N días desde hoy, así que un deal de hace seis meses ya no tiene su actividad dentro de la ventana. Para calibrar, usá deals recientes o fijate en las reglas de ajuste, que no vencen.

## Paso 4: que el score genere trabajo

Un número en una columna no llama a nadie. Los workflows del CRM tienen el disparador "Cambió el lead score" con un umbral opcional y una dirección (sube, baja o cualquiera). Tres recetas:

- **Sube de 50:** crear una tarea para el responsable que diga "Llamar hoy" y actualizar la etapa del ciclo de vida a SQL.
- **Sube de 30:** inscribir en una secuencia de seguimiento. Contamos cómo armarla en [este post sobre secuencias](/blog/secuencias-de-seguimiento-que-se-cortan-solas).
- **Baja de 30:** tarea de revisión. Alguien que estaba caliente y se enfrió merece un mensaje humano antes de que vuelva a la pila.

Si querés avisar en otra herramienta, el CRM emite el evento `contact.score_changed`, que podés tomar desde Flow o con un webhook.

## Paso 5: una revisión por mes

Quince minutos alcanzan. Mirá qué reglas casi nunca se cumplen (sobran o la condición está mal escrita) y cuáles se cumplen en casi todos (no distinguen a nadie). Ajustá puntos de a poco y anotá cada cambio en una página de Docs, así la próxima persona sabe por qué una regla vale 25 y no 10.

## Lo que todavía no hace

- No hay score predictivo ni pesos sugeridos a partir de tu historial.
- Las reglas leen solo propiedades del contacto, no de su empresa ni de sus deals.
- No hay un score separado por pipeline o por producto; la separación de ajuste e interés es por nombre.
- Cada regla suma una vez; no hay puntos por cada ocurrencia.

Si necesitás alguna de esas cosas hoy, te conviene un CRM más grande. Si tu problema es decidir a quién llamar el lunes, diez reglas que entendés te van a servir más que un modelo que nadie puede explicar. El CRM de zerosoft corre por $0 en tu servidor, o en zerosoft Cloud con el plan gratis para empezar.
