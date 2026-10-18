---
title: "Cómo organizar tus notas: cuatro libretas, pocas etiquetas y una búsqueda que encuentra"
description: "Un sistema de notas que se arma en una tarde: cuatro libretas inspiradas en PARA, una lista corta de etiquetas, fijadas para lo diario y una búsqueda en todo el texto. Con los pasos en Notes y lo que todavía le falta."
date: "2026-10-18"
author: "zerosoft"
tags: ["notes", "evernote", "productividad"]
---

Casi todas las guías para organizar notas empiezan por la estructura: libretas, pilas de libretas, etiquetas anidadas, convenciones de nombres. Evernote tiene una guía entera sobre [cómo organizar notas](https://evernote.com/learn/how-to-organize-notes) y otra sobre el [método PARA](https://evernote.com/learn/what-is-the-para-method). Son buenos puntos de partida. El problema es que la estructura se vuelve el trabajo, y un mes después nadie sabe si la receta va en "Casa" o en "Recursos".

Este post propone lo contrario: la menor estructura posible, porque la búsqueda hace la mayor parte del trabajo. Cuatro libretas, una lista corta de etiquetas y un par de hábitos. Te mostramos cómo armarlo en Notes, la app de notas de zerosoft, y qué cosas de Evernote todavía no tenemos.

## La regla de partida: guardá rápido, ordená poco

Una nota que no se guardó porque "no sabía dónde ponerla" es la única nota perdida de verdad. Por eso el sistema tiene una sola regla para el momento de anotar: escribí y listo. Si no sabés dónde va, queda suelta. Ordenar queda para la revisión semanal.

En Notes, apretá `N` desde cualquier lugar de la lista y se abre una nota nueva. Apretá `/` y el cursor salta al buscador. Con esos dos atajos el costo de anotar es casi cero.

## Cuatro libretas, al estilo PARA

PARA, de Tiago Forte, divide todo en Proyectos, Áreas, Recursos y Archivo. Lo tomamos tal cual porque responde una sola pregunta: ¿esto tiene fecha de fin?

1. **Proyectos.** Algo con un final: "Mudanza de oficina", "Lanzamiento de octubre", "Viaje a Lisboa". Cuando termina, sus notas se van al Archivo.
2. **Áreas.** Responsabilidades que no terminan: finanzas, salud, el equipo, los clientes.
3. **Recursos.** Temas que te interesan y querés tener a mano: recetas, artículos guardados, referencias de diseño.
4. **Archivo.** Todo lo que ya no está activo. No se borra: se aparta.

Fijate que los proyectos no son libretas propias. Cada proyecto es una etiqueta dentro de la libreta Proyectos. Así no terminás con cuarenta libretas, y cerrar un proyecto es mover sus notas de libreta, una por una o al hacer la revisión.

En Notes creás las cuatro desde la barra lateral. Cada nota vive en una libreta (o en ninguna). Si borrás una libreta, sus notas van a la papelera y las podés restaurar desde ahí.

Un dato sobre el punto de partida: el plan Free de Evernote permite [una sola libreta y 50 notas](https://evernote.com/compare-plans), así que este sistema ya pide un plan pago allá. En Notes no hay tope de libretas ni de notas por plan.

## Etiquetas: una lista corta y cerrada

Las etiquetas sirven para lo que cruza libretas. Una factura del proveedor puede estar en Áreas y llevar la etiqueta del cliente. El error típico es crear una etiqueta por cada tema nuevo. A los tres meses hay doscientas, la mitad con una sola nota.

Una lista que entra en una tarjeta:

- **Una por proyecto activo**, con el mismo nombre en todos lados: `mudanza`, `lanzamiento-oct`.
- **Una por persona o cliente** con el que trabajás seguido: `acme`, `lucia`.
- **Tres de estado**, como mucho: `pendiente`, `referencia`, `idea`.

Notes pasa cada etiqueta a minúsculas y cambia los espacios por guiones, así que `Lanzamiento Oct` y `lanzamiento-oct` terminan siendo la misma. La regla que queda a tu cargo: si una etiqueta no está en la lista, primero se agrega a la lista. Notes acepta hasta 20 etiquetas por nota, pero si una nota necesita más de tres, probablemente son dos notas.

Para etiquetar, abrí la nota y escribí en el campo de etiquetas: Enter o coma agregan una, Backspace sobre el campo vacío borra la última. En la barra lateral aparece cada etiqueta con su cantidad de notas, y un clic filtra la lista.

## Fijadas: lo que abrís todos los días

Hay cinco o seis notas que usás a diario: la lista del súper, el checklist de apertura del local, la agenda de la semana. No las busques. Fijalas. En Notes, las fijadas aparecen primero en la lista y tienen su propia vista.

Si fijaste más de diez, dejaron de ser especiales. Revisalas en la revisión semanal.

## La búsqueda hace el resto

Acá está el motivo de tener tan poca estructura. La búsqueda de Notes mira el título y todo el texto de cada nota. Si tu base lo soporta (SQLite y Turso con FTS5), funciona así:

- **Busca por prefijo.** `presu` encuentra "presupuesto" y "presupuestos".
- **Pide todas las palabras.** `acme factura` trae solo las notas que tienen las dos.
- **Ordena por relevancia** y pesa más el título que el cuerpo.
- **Muestra un fragmento** alrededor de la coincidencia, para que sepas cuál es antes de abrirla.

Combinala con los filtros: elegí la libreta Áreas, la etiqueta `acme` y escribí `contrato`. Tres clics, una nota.

Un consejo que vale más que cualquier etiqueta: escribí el título que vas a buscar. "Reunión" no lo encuentra nadie. "Acme: precios 2027, reunión con Lucía" se encuentra solo.

## Guardar de la web sin copiar y pegar

Notes trae un clipper como bookmarklet: lo arrastrás a la barra de favoritos y, desde cualquier página, guarda una nota con el título de la página, el link de origen y el texto que tenías seleccionado, citado en bloques. La nota llega con la etiqueta `clip`, así que en la revisión semanal filtrás por esa etiqueta y decidís a qué libreta va cada una.

Una diferencia honesta con el Web Clipper de Evernote: el nuestro guarda tu selección y el link. No copia la página entera ni las imágenes. Para un artículo largo, seleccioná los párrafos que te importan; suele ser mejor nota que la página completa.

## Preguntarle a tus notas

Cuando no te acordás dónde quedó algo, la búsqueda necesita que recuerdes una palabra. "Preguntale a tus notas" acepta una pregunta normal: "¿cuánto le cobramos a Acme el año pasado?". Notes busca las notas más relevantes por palabras clave, se las pasa a un modelo con la instrucción de responder solo con eso, y te muestra qué notas usó. Si ninguna habla del tema, te lo dice.

Necesita la IA configurada en tu instalación. En zerosoft Cloud se cobra por tokens. Si no la activás, la búsqueda sigue funcionando igual.

## La revisión semanal, en quince minutos

1. Filtrá por `clip` y por las notas sin libreta. Movelas o borralas.
2. Abrí la libreta Proyectos. Si un proyecto terminó, mové sus notas al Archivo.
3. Mirá las fijadas. Desfijá lo que ya no abrís.
4. Revisá la lista de etiquetas en la barra lateral. Las que tienen una sola nota, borralas o fusionalas a mano.
5. Vaciá la papelera si hace falta.

## Lo que Notes todavía no hace

Para que decidas con todo sobre la mesa:

- **No hay importador de Evernote.** Hoy se migra pegando contenido o con el clipper.
- **No hay exportación de notas.** Si hosteás zerosoft vos, las notas están en tu propia base de datos, pero falta un botón para bajarlas.
- **No hay recordatorios, ni pilas de libretas, ni etiquetas anidadas.** Las libretas son un solo nivel.
- **No adjuntás PDFs ni archivos, y no hay OCR** sobre imágenes, una de las funciones más útiles de Evernote.
- **Las notas son personales.** Compartís una con un link de solo lectura, que podés cortar cuando quieras, pero no hay libretas compartidas para editar en equipo. Para eso está [Docs](/blog/wiki-interna-con-docs).

## La tarjeta para pegar en el monitor

- Anotá con `N`, buscá con `/`. Ordená después.
- Cuatro libretas: Proyectos, Áreas, Recursos, Archivo.
- Etiquetas: una por proyecto, una por cliente, tres de estado. Minúsculas.
- Fijá lo diario, nunca más de diez.
- Títulos que se puedan buscar.
- Quince minutos por semana: clips, proyectos cerrados, fijadas, etiquetas sueltas.
