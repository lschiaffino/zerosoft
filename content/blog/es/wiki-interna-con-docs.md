---
title: "Una wiki interna con Docs, paso a paso"
description: "Cómo armar con Docs una wiki de empresa que la gente use: árbol de páginas, links con [[, plantillas, comentarios, permisos y papelera, y los límites que conviene conocer antes."
date: "2026-08-25"
author: "zerosoft"
tags: ["docs", "wiki", "playbook"]
---

Toda empresa tiene una wiki. La mayoría son un cementerio: una página de onboarding de hace tres años, una carpeta "Procesos (WIP)" y un link a un Google Doc que nadie puede abrir. Casi nunca el problema es la herramienta. Es la estructura.

Esta es una guía paso a paso para armar una wiki interna con Docs que se mantenga viva. Docs tiene pocas piezas (páginas anidadas, links con `[[`, plantillas, comentarios, permisos y papelera), y eso ayuda: menos piezas, menos formas de desordenarse.

## Paso 0: un workspace para el equipo

Si usás Docs dentro de un workspace de equipo, todos los miembros trabajan sobre el mismo árbol de páginas. Esa es tu wiki. No necesitás un "modo wiki"; necesitás ponerte de acuerdo en el primer nivel del árbol.

Lo que nos lleva a la decisión más importante.

## Paso 1: diseñá el primer nivel (y que sea corto)

Las páginas de Docs se anidan tan profundo como quieras. Cada página puede tener subpáginas, y la barra lateral muestra el árbol entero. Eso es una trampa si arrancás con quince páginas de primer nivel. Empezá con cinco o seis, como mucho:

- **Empezá acá**: qué hace la empresa, quién es quién, dónde vive cada cosa.
- **Cómo trabajamos**: procesos, rituales, políticas.
- **Equipos**: una subpágina por equipo, y cada equipo es dueño de su subárbol.
- **Clientes**: playbooks, preguntas frecuentes, caminos de escalamiento.
- **Decisiones**: una página por decisión, las más nuevas primero.
- **Archivo**: adonde va lo viejo en lugar de borrarse.

Creá una página desde la barra lateral con **Nueva página**, y una subpágina con la flechita al lado de cualquier página del árbol. Reorganizar es drag-and-drop: arrastrá una página sobre otra para anidarla adentro, o sobre la zona de primer nivel para subirla. Mover una página mueve todo su subárbol con ella.

Ponele un ícono a cada página de primer nivel (hay selector de emojis) y, si querés, una portada. Parece cosmético; es cómo la gente encuentra las cosas de un vistazo en la barra lateral.

## Paso 2: escribí páginas que se puedan leer en diagonal

El editor es por bloques: escribí `/` para abrir el menú de comandos. Tenés párrafos, tres niveles de título, listas con viñetas y numeradas, to-dos, citas, bloques de código con lenguaje, divisores, tablas simples y un bloque de **base de datos**: una tabla chica con columnas tipadas (texto, número, select, fecha) que también podés ver como galería. El formato inline cubre lo de siempre: negrita, cursiva, links, etcétera.

Para páginas de wiki la regla es simple: primero títulos, después prosa. El que cae en "Política de gastos" quiere la respuesta en cinco segundos, no un cuento. Una tabla o un bloque de base de datos chiquito suele rendir más que tres párrafos: por ejemplo, la lista de herramientas con su responsable y su fecha de renovación.

## Paso 3: linkeá todo con `[[`

La diferencia entre una wiki y una carpeta de documentos son los links. En cualquier página, escribí `[[` y empezá a tipear el título de una página; Docs busca por título mientras escribís e inserta un link a la que elijas.

Usalo sin miedo:

- Cada página de proceso linkea a la página del equipo que es dueño.
- Cada página de decisión linkea a las páginas que cambió.
- La página **Empezá acá** es casi toda links con `[[`.

¿Necesitás que alguien en particular mire algo? Escribí `@` y elegí a un compañero. Le llega una notificación de que lo mencionaste en esa página.

La búsqueda de Docs es por título: es lo que hace funcionar al `[[`. No busca dentro del contenido de las páginas. Otra razón para usar títulos descriptivos: "Política de gastos" le gana a "Cosas de plata v2".

## Paso 4: templates, incluidos y caseros

Cuando creás una página desde el inicio de Docs, podés arrancar de un template: **Notas de reunión** (agenda, notas, acciones), **Spec de proyecto** (problema, objetivos, no-objetivos, plan, preguntas abiertas), **Retro semanal** o una página en blanco.

Todavía no podés guardar tus propios templates, pero hay un buen workaround: armá una página **Templates** en el primer nivel, poné abajo tus formatos de la casa (un "Postmortem de incidente", un "Registro de decisión", un "Checklist de ingreso") y usá **Duplicar** desde las opciones de página cuando necesites uno. Duplicar copia la página y todas sus subpáginas, así que un template puede ser hasta un árbol chico: digamos, una página de proyecto con "Spec", "Checklist de lanzamiento" y "Retro" ya anidadas adentro. Después arrastrás la copia adonde corresponde.

## Paso 5: comentarios en vez de conversaciones paralelas

Cada página tiene un panel de comentarios. Podés comentar la página entera o un bloque específico, así el feedback queda al lado del párrafo al que se refiere y no en un hilo de chat que nadie va a encontrar después.

Resolvé un comentario cuando está atendido; lo podés reabrir si no lo estaba. Un buen hábito para los dueños de la wiki: una vez por mes, abrí tus páginas y limpiá los comentarios sin resolver. Comentarios abiertos en una página de wiki suelen querer decir que la página está mal.

## Paso 6: compartir

Cada página tiene un panel **Compartir** con tres tipos: público, con un equipo o con un usuario puntual. Para una wiki interna, el workspace de equipo ya le da a tu equipo el árbol completo, así que la mayoría de las páginas no necesita nada más.

Dos aclaraciones honestas. Primero, Docs no es un constructor de sitios públicos: si lo que querés es un centro de ayuda para clientes con dominio propio y SEO, eso es otra herramienta. Segundo, la edición sigue al workspace: no hay un "solo lectura" por página para miembros del mismo equipo.

## Paso 7: la papelera, y el hábito del archivo

Borrá una página y va a la **Papelera** en el inicio de Docs, donde la podés restaurar o eliminar definitivamente. Eliminar definitivamente también borra sus subpáginas, y eso no tiene vuelta atrás.

Nuestra recomendación: usá la papelera para los errores y la página **Archivo** para la historia. Los procesos viejos se arrastran bajo Archivo con una línea arriba que diga qué los reemplazó y un link con `[[`. La historia sirve; la confusión, no.

## Bonus: que tu wiki le responda a los clientes

Si también usás Chat, el bot de respuesta automática puede usar tus páginas de Docs como fuente. Sin IA configurada, compara las palabras del visitante con los títulos y el texto de las páginas y responde con un extracto de la que mejor coincide; con IA, el modelo lee las páginas que encuentra. En los dos casos funciona mejor con páginas cortas y bien tituladas. O sea, lo que tiene una buena wiki de todos modos.

## Los límites que conviene saber antes de arrancar

Docs no tiene coedición en tiempo real: si dos personas editan la misma página al mismo tiempo, gana el último que guarda. Pensá en dueños de página, no en multitudes. Tampoco hay búsqueda de texto completo, ni exportación a JSON o Markdown todavía, ni importación desde Notion. Si tu equipo vive en una página gigante que editan diez personas a la vez, o necesitás traer años de contenido de Notion, esos huecos pesan.

Para un equipo que quiere una wiki ordenada, linkeada y propia, en su propio servidor, gratis si la hosteás vos, o en zerosoft Cloud con un tier gratuito, las piezas de arriba alcanzan. El resto es disciplina, y eso no lo vende ninguna herramienta.
