---
title: "Migrar de Notion a Docs: dos caminos y una lista de control"
description: "Cómo pasar tu workspace de Notion a Docs con el export en Markdown y CSV o con una integración por API: qué viaja, qué conviene revisar y en qué orden hacerlo."
date: "2026-10-29"
author: "zerosoft"
tags: ["docs", "notion", "migración"]
---

Un workspace de Notion se acumula durante años: wikis, bases de datos de proyectos, notas de reunión, páginas que alguien duplicó "por las dudas". Moverlo a otro lado da pereza, y casi siempre por una pregunta que no tiene respuesta a mano: ¿qué se pierde en el camino?

Esta guía responde eso para Docs. Hay dos caminos de importación, una lista para hacer antes y otra para revisar después. Si todavía estás evaluando si Docs te alcanza, mirá primero la [comparación con Notion](/blog/zerosoft-docs-vs-notion).

## Antes de empezar: ordená lo que vas a mover

Importar es una buena excusa para no llevar la basura. Con una hora de trabajo antes ahorrás varias después:

1. Abrí tu workspace y listá las diez páginas que tu equipo realmente consulta.
2. Marcá las bases de datos que siguen vivas (con filas editadas en los últimos meses).
3. Archivá o borrá lo demás. Si dudás, exportalo igual y dejalo en una página Archivo.

Con ese mapa, el resto es mecánico.

## Camino 1: el export en Markdown y CSV

Es el camino más simple y no necesita credenciales de nadie.

**En Notion.** Según su [ayuda oficial sobre exportación](https://www.notion.com/help/export-your-content), el export de todo el workspace está en Settings, General, Export all workspace content, y Notion lo prepara y te manda un mail con un link de descarga. Notion avisa que puede tardar mucho en workspaces grandes y que el link vence a los 7 días, así que no lo dejes para el último día. También podés exportar una sola página desde el menú de tres puntos. Elegí Markdown & CSV, con subpáginas y con archivos e imágenes.

**En Docs.** Entrá a Docs, abrí Importar, elegí Notion como origen, el destino (el workspace o un teamspace donde puedas escribir) y subí el .zip. Antes de escribir nada, Docs te muestra una vista previa con la cantidad de páginas, bases, archivos y tamaño, y el árbol de páginas. Si todo está bien, confirmás.

Lo que hace el importador, por lo que dice el código:

- Cada archivo .md pasa a ser una página, con el mismo árbol de carpetas que arma Notion.
- Los links entre páginas del export se convierten en links `[[` a las páginas nuevas, así que la red de referencias sobrevive.
- Las imágenes y adjuntos se suben a tu almacenamiento como bloques de imagen o archivo.
- Los bloques `<aside>` de Notion pasan a callouts.
- Cada CSV pasa a ser un bloque de base de datos, con los tipos de columna detectados. La página de cada fila entra como el cuerpo de esa fila, no como una subpágina.
- Los límites: hasta 1 GB por archivo y 5.000 páginas por import. Si reimportás el mismo export, las páginas que ya entraron se saltean en lugar de duplicarse.

## Camino 2: la integración por API

Sirve cuando no querés esperar un export, cuando necesitás traer solo una parte o cuando querés volver a sincronizar después.

1. En Notion, creá una integración interna y copiá su secreto. Dale permiso para leer contenido y, si querés que las personas coincidan con tus miembros, para leer información de usuarios con email.
2. En cada página raíz que quieras traer, abrí el menú de tres puntos, Conexiones, y agregá la integración. Lo que no compartas con ella no se ve.
3. En Docs, andá a Ajustes, Importar, Notion, pegá el secreto y elegí el destino. Docs prueba el token con un pedido de lectura antes de importar nada.
4. Revisá la vista previa: te muestra páginas, bases y filas, y te deja elegir qué traer (páginas, bases, imágenes y archivos) y estima cuánto tarda.

Este camino respeta el límite de la API de Notion de 3 pedidos por segundo, por eso una importación grande puede llevar varios minutos. Si se corta, sigue desde donde quedó. Las menciones y los links entre páginas se reescriben hacia las páginas importadas, las fórmulas y los rollups entran con su valor actual (no como fórmula viva), y los archivos de hasta 10 MB se copian a tu almacenamiento.

Una ventaja práctica: si importás de nuevo, lo ya importado se actualiza en vez de duplicarse. Y si alguien editó en zerosoft una página importada, no se pisa a menos que elijas reemplazarla a propósito. Eso permite una migración en etapas: traés un equipo, lo probás una semana y después traés el siguiente.

## Qué conviene revisar después

Ninguna migración es idéntica al origen. Dedicale media hora a esta lista:

- **Páginas clave.** Abrí tus diez páginas más usadas y comparalas con Notion. Títulos, listas, tablas y código tienen que verse igual.
- **Bases de datos.** Revisá los tipos de columna que detectó (fechas, selects, números) y las vistas. Las fórmulas y rollups vienen con el valor del momento de la importación; si dependías de que se recalcularan, hay que rehacerlas.
- **Links.** Buscá una página con muchas referencias y hacé clic en cada `[[`.
- **Archivos grandes.** Los que pasan los 10 MB quedan con su nombre pero no se suben. El resumen del import te dice cuántos fueron.
- **Accesos.** Los permisos de Notion no viajan. Las páginas quedan con el acceso del destino que elegiste, así que armá el teamspace antes de importar y dale los miembros correctos.
- **Páginas públicas.** Si publicabas páginas de Notion con un link, tenés que volver a publicarlas desde Docs; la URL cambia.

## Un plan de una semana

- **Día 1.** Ordená el workspace de Notion y pedí el export.
- **Día 2.** Importá un teamspace de prueba y revisá la lista de arriba.
- **Día 3.** Corregí lo que haya salido distinto y avisá al equipo.
- **Día 4.** Importá el resto con el destino definitivo.
- **Día 5.** Pasá el hábito: la wiki nueva es la única donde se escribe.
- **Después.** Dejá Notion en solo lectura un mes y exportalo una última vez antes de cerrar.

## Por qué vale la pena pensar en la salida

Migrar es un buen momento para preguntarte dónde viven tus datos. En Docs podés exportar cada página a Markdown o PDF, y si hosteás zerosoft vos mismo, las páginas están en tu base de datos y en tu almacenamiento. La próxima mudanza, si alguna vez hace falta, no depende de un mail con un link que vence. Docs tiene sus propios límites, que publicamos en la [página de producto](/products/docs): conviene leerlos antes de decidir.
