---
title: "Cómo migrar de Excalidraw a Board (y qué pasa con Miro)"
description: "Guía para importar tus archivos .excalidraw a Board de a muchos: qué elementos e imágenes viajan, qué se descarta, los límites y qué hacer si venís de Miro."
date: "2026-10-31"
author: "zerosoft"
tags: ["board", "excalidraw", "migración", "guía"]
---

[Board](/products/board) corre el mismo editor open source que Excalidraw. Eso hace que la mudanza desde Excalidraw o Excalidraw+ sea corta: el formato `.excalidraw` se lee tal cual y lo que dibujaste se ve igual del otro lado. Con Miro la historia es distinta, y la contamos al final con lo que de verdad se puede hacer.

## Qué lee el importador

Un solo formato: los archivos `.excalidraw`, que son el JSON de una escena de Excalidraw. Los genera el editor de excalidraw.com y también Excalidraw+, desde **Guardar en…** (Save to…) en el menú. El selector acepta además archivos `.json` con ese mismo contenido.

No lee bibliotecas (`.excalidrawlib`): una biblioteca de formas no es una escena, y el importador la rechaza.

Los límites:

- **50.000 elementos** por archivo.
- **4 MB por escena.** El archivo que subís, con las imágenes adentro, puede pesar hasta 4,5 MB.
- **Hasta 50 archivos** por vez desde la lista.

## Qué se importa

- **Todos los elementos vivos de la escena:** formas, flechas, líneas, texto, dibujo a mano, frames y lo que haya en el lienzo. Los elementos que Excalidraw había marcado como borrados se descartan.
- **Las imágenes pegadas en la pizarra**, si vienen dentro del archivo en PNG, JPEG, GIF o WebP. Las imágenes SVG se convierten a PNG en tu navegador antes de subir. Todas pasan al storage como en cualquier guardado.
- **El color de fondo** y el **tamaño de la grilla**.
- **El nombre:** cada archivo se vuelve una pizarra nueva con el nombre del archivo, sin la extensión.

## Qué no se importa

- **Imágenes por URL.** Si el archivo apunta a una imagen en otro sitio en vez de traerla adentro, esa imagen no se guarda.
- **Links peligrosos.** Un elemento con un link `javascript:` o `data:` queda sin link.
- **El HTML generado por IA** con wireframe a código, y el elemento que lo mostraba. En Board esa vista queda solo en la sesión de quien la generó.
- **El resto del estado del editor:** zoom, posición, tema y herramienta elegida. Board abre la pizarra con sus propios valores.
- **Lo que no está en el archivo:** comentarios, colaboradores, historial o carpetas de Excalidraw+. Un `.excalidraw` guarda la escena y nada más.

## Paso a paso

### Muchos archivos a la vez

1. **Juntá tus archivos.** En excalidraw.com o en Excalidraw+, abrí cada escena y usá **Guardar en…** para bajar el `.excalidraw`.
2. **Abrí la lista de Board.** Si querés que caigan en una carpeta, entrá primero a esa carpeta.
3. **Tocá Importar**, al lado de Nueva pizarra, y elegí todos los archivos juntos.
4. **Mirá el resultado.** Si fue un solo archivo, Board abre la pizarra. Si fueron varios, aparecen en la lista y un aviso dice cuántas se importaron y cuántas no se pudieron leer como `.excalidraw`.

### Un archivo dentro de una pizarra

Dentro de una pizarra que podés editar, el menú del lienzo tiene **Abrir**. Carga un `.excalidraw` en esa pizarra y, después de pedirte confirmación, reemplaza lo que había. Sirve para rehacer una pizarra que ya compartiste sin cambiar su link.

## Qué revisar después

- **Las pizarras que fallaron.** Si el aviso dice que alguna no se pudo leer, casi siempre es una biblioteca en vez de una escena, o un archivo que pasa de 50.000 elementos o 4 MB. Para las pesadas, sacá imágenes o partila en dos escenas en Excalidraw antes de exportar.
- **Las imágenes.** Abrí una pizarra con fotos y confirmá que estén todas. Las que faltan eran por URL: pegalas de nuevo.
- **Los nombres.** Un archivo llamado `Untitled-2024-03-01.excalidraw` se vuelve una pizarra con ese nombre. Renombrala desde la lista.
- **Cmd+K.** Las pizarras importadas se encuentran por nombre y por el texto de adentro.

## Si venís de Miro

Board no importa tableros de Miro. No lee su formato y no hay conexión con su API. Lo que sí podés hacer:

- **Traer el tablero como referencia.** En Miro, desde el menú del tablero, **Save as image** baja un JPG del área que elijas. Pegalo en una pizarra de Board como imagen y dibujá encima. En el plan gratis de Miro la exportación sale solo en tamaño chico.
- **Pasar los stickies como texto.** La herramienta de stickies de Board tiene **Pegar una lista**: una línea por sticky, hasta 100 de una vez, y las palabras con `#` quedan como tags. Si tenés el texto de tus stickies en una lista, en un minuto los tenés en el lienzo.

Después, para ordenar lo que trajiste, Board puede agrupar stickies por tema con IA, votar por puntos y correr un timer compartido. Hay ejemplos en [lluvia de ideas con Board](/blog/lluvia-de-ideas-con-board) y en [retro en una pizarra](/blog/retro-en-una-pizarra).

## Lo que todavía falta

Nuestra tabla de paridad compara Board con Excalidraw+. Los huecos que marcamos:

- **Relleno con balde, autoshape y lápiz de ancho fijo.** Excalidraw+ los sumó en 2026 y no están en la versión del editor que usamos.
- **Voz y pantalla compartida.** No hay.
- **Roles.** Hay roles del workspace más edición o lectura por pizarra, sin otros roles por pizarra.
- **Offline.** Lo no guardado queda como borrador local que podés restaurar. No hay modo offline que sincronice después.
- **Pizarras grandes.** Hasta 4 MB por escena, con aviso al pasarse.
- **Wireframe a código.** La página generada queda en la sesión de quien la generó. No se guarda ni se comparte.

## Cuánto cuesta

Miro Starter cuesta cerca de $10 por usuario por mes con facturación mensual. Board en tu servidor cuesta $0, con el código bajo AGPLv3 y todas las funciones. En zerosoft Cloud hay un plan gratis para empezar y después pagás por uso, como el almacenamiento de las imágenes. Los asientos no se cobran, así que sumar a todo el equipo a un taller no cambia la factura. La comparación con Excalidraw+ está en [zerosoft vs Excalidraw+](/compare/zerosoft-vs-excalidraw-plus).
