---
title: "Cómo migrar de Evernote a Notes con archivos .enex"
description: "Guía para pasar tus libretas de Evernote a Notes: cómo exportar el .enex, qué viaja (adjuntos, etiquetas, fechas, tareas), qué se pierde y qué revisar después."
date: "2026-10-31"
author: "zerosoft"
tags: ["notes", "evernote", "migración", "guía"]
---

Mudarse de Evernote asusta por el volumen: años de notas, recortes, PDFs escaneados y listas de tareas a medio tachar. La buena noticia es que Evernote exporta todo a un formato abierto, el `.enex`, y [Notes](/products/notes) lo lee. Acá va qué trae el importador nota por nota, qué deja afuera y cómo hacerlo libreta por libreta para que no termines con todo mezclado.

## Qué necesitás

No hace falta token ni conexión a la cuenta de Evernote. Solo los archivos `.enex` que exporta la app de escritorio. Cualquier persona del workspace puede importar a Notes: no hace falta ser admin.

Los límites, que salen del código del importador:

- **4 MB por archivo** `.enex`.
- **500 notas por archivo.** Si una libreta tiene más, el archivo se rechaza entero: exportala en partes.
- **100 adjuntos por archivo**, cada uno de hasta 4 MB.
- **Hasta 20 archivos** por vez desde el selector.

## Qué se importa

De cada nota del `.enex`:

- **El título.**
- **El contenido**, convertido a bloques del editor: títulos (los niveles 4 a 6 pasan a H3), párrafos, listas con viñetas y numeradas, citas, bloques de código, separadores y tablas.
- **Las casillas de tarea**, con su estado. Una tarea tachada en Evernote llega tachada.
- **El formato de texto:** negrita, cursiva, subrayado, tachado, código y links (`http`, `mailto` y `tel`).
- **Los adjuntos.** Imágenes, PDFs y otros archivos se suben y quedan en el mismo lugar donde estaban dentro de la nota. Los que no aparecían en el texto van al final.
- **Las etiquetas.**
- **Las fechas de creación y de última edición**, así el orden de la lista se respeta.
- **El link de origen**, en las notas que recortaste de una página web.

También podés importar archivos Markdown (`.md`, `.markdown` o `.txt`): una nota por archivo, con el título del front matter, de un `# Título` inicial o del nombre del archivo.

## Qué no se importa

- **El nombre de la libreta.** El `.enex` no lo trae. Las notas caen en la libreta que tengas abierta al importar (más abajo, cómo aprovecharlo).
- **El texto cifrado** con la función de encriptar de Evernote. Se descarta: descifralo en Evernote antes de exportar.
- **Las imágenes remotas**, las que estaban como link a otra web y no como adjunto.
- **Colores, tipografías y resaltado.** Las tablas llegan con el texto de cada celda, sin formato, hasta 200 filas y 20 columnas.
- **Recordatorios, autor y ubicación** de la nota.
- **Adjuntos bloqueados**, como SVG o HTML, y los que pasan de 4 MB. La nota se importa igual, sin ese archivo.

## Paso a paso

1. **Exportá desde Evernote.** En la app de escritorio, hacé clic derecho en la libreta › Exportar libreta y elegí el formato `.enex`. Repetí con cada libreta.
2. **Creá las libretas en Notes.** Una por cada libreta de Evernote, con el mismo nombre.
3. **Abrí la libreta de destino** en el sidebar de Notes.
4. **Tocá Importar notas**, abajo en el sidebar, y elegí el `.enex` de esa libreta. Las notas se crean ahí.
5. **Mirá el aviso.** Dice cuántas notas se importaron y si algún archivo no se pudo leer.
6. Repetí con la siguiente libreta.

Si importás sin ninguna libreta abierta, las notas quedan sueltas en Todas las notas. Las podés mover después seleccionando varias a la vez, pero es más rápido hacerlo libreta por libreta desde el principio.

## Qué revisar después

- **Las cantidades.** Compará cuántas notas tenía cada libreta en Evernote con las que dice el aviso.
- **Una nota con adjuntos pesados.** Si falta un PDF, probablemente pasaba de 4 MB.
- **Las etiquetas.** Aparecen en el sidebar. Si en Evernote tenías variantes del mismo tag, ahora es buen momento para renombrarlas y juntarlas. Lo contamos en [cómo organizar notas con libretas y etiquetas](/blog/organizar-notas-libretas-y-etiquetas).
- **Que no haya duplicados.** Importar el mismo archivo dos veces crea las notas dos veces. Si un import se cortó a mitad, borrá lo importado antes de repetir.

## Y si querés volver

La salida está igual de abierta: cada nota se exporta como Markdown, `.enex` con adjuntos, HTML o PDF (desde imprimir), y una libreta entera o todas las notas se bajan como `.enex`. Escribimos por qué esto nos importa en [exportar tus datos debería ser un derecho](/blog/exportar-tus-datos-deberia-ser-un-derecho).

## Lo que todavía falta

Nuestra tabla de paridad contra Evernote marca estos huecos:

- **Buscar texto dentro de imágenes y escaneos.** El texto de los PDF comunes se puede buscar. Leer imágenes y escaneos se activa por workspace y todavía no se probó con un modelo real. Si tu Evernote está lleno de recibos escaneados, tenelo en cuenta.
- **Coedición en vivo.** Notes detecta cambios de otra persona y te deja conservar los tuyos o cargar los últimos, pero dos personas no editan la misma nota a la vez.
- **Integraciones con Slack, Google y Outlook.** No hay.
- **Mail a una nota.** Está hecho y probado, pero todavía no está disponible en zerosoft Cloud.
- **Apps nativas.** Notes es una app web instalable que funciona a 390 px y sin conexión. No hay app nativa ni widgets.
- **Transcripción con hablantes.** Las grabaciones se transcriben, pero los hablantes solo se separan con una key de Deepgram o AssemblyAI.

## Cuánto cuesta

Evernote Personal cuesta cerca de $14,99 por mes con facturación mensual. Notes en tu servidor cuesta $0: el código es AGPLv3 y trae todas las funciones. En zerosoft Cloud hay un plan gratis para empezar y después pagás por uso, como el almacenamiento de los adjuntos. Los asientos no se cobran. La comparación completa está en [zerosoft vs Evernote](/compare/zerosoft-vs-evernote) y, si estás buscando opciones, en [alternativas a Evernote](/compare/evernote-alternative).
