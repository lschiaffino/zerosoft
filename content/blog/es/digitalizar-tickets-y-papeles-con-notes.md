---
title: "Digitalizar tickets y papeles con el teléfono: un método de diez minutos por semana"
description: "Cómo pasar de la caja de zapatos a notas que se encuentran: cómo sacar la foto, escanear varias páginas a un PDF en Notes, nombrar, etiquetar y buscar. Con lo que la lectura de texto hace hoy y lo que todavía no."
date: "2026-11-01"
author: "zerosoft"
tags: ["notes", "evernote", "documentos"]
---

Evernote publica una guía sobre [cómo escanear y organizar tickets](https://evernote.com/en-us/learn/how-to-scan-receipts). Los consejos de base son los correctos: alisar el papel, buscar buena luz y guardar una copia de respaldo. Después la guía se apoya en el reconocimiento de texto de su app para que los escaneos se puedan buscar.

Este post toma el mismo problema (una pila de papeles que no se encuentra cuando hace falta) y lo resuelve con Notes, la app de notas de zerosoft. Incluye un método con horarios, una convención de nombres y una lista de lo que Notes todavía no hace, que no es corta.

## Qué conviene digitalizar y qué no

Antes de sacar la primera foto, decidí qué entra. Un criterio simple: digitalizá lo que podrías necesitar probar o buscar, y tirá el resto.

- **Sí:** facturas y tickets de compras grandes, garantías, contratos, comprobantes de pago de impuestos, recetas, certificados.
- **Depende:** resúmenes de cuenta (muchos bancos ya los dan en PDF, bajá el PDF en vez de fotografiar el papel).
- **No:** folletos, tickets de un café, correspondencia que ya contestaste.

Ojo con los papeles térmicos de los tickets: la tinta se borra con el tiempo. Si un ticket es una garantía, escanealo la misma semana.

## Sacar una buena foto

La calidad del escaneo se decide antes de tocar la app.

1. Poné el papel sobre una superficie lisa y de color distinto al de la hoja. Una mesa oscura para una hoja blanca ayuda a que se detecten los bordes.
2. Alisalo. Un ticket enrollado se lee mal en la parte curva.
3. Usá luz de ventana o una lámpara de costado. Evitá que tu sombra o el flash caigan sobre la hoja.
4. Sostené el teléfono paralelo al papel. Con la corrección de perspectiva se arregla un ángulo, pero no una foto movida.

## Escanear en Notes, paso a paso

Abrí una nota (puede ser una nueva) y elegí "Escanear documento" en la barra del editor. El flujo es este:

1. **Sacá o elegí una foto.** En el teléfono abre la cámara trasera. En la computadora te deja elegir un archivo.
2. **Ajustá las cuatro esquinas.** Notes intenta detectar los bordes de la hoja solo. Si se equivoca, arrastrá cada esquina hasta su lugar o movelas con las flechas del teclado.
3. **Dejá prendido "Limpiar para leer".** Pasa la imagen a escala de grises y ajusta los niveles para que el fondo quede claro y el texto oscuro. Si es una foto con colores que importan (un plano, un gráfico), apagalo.
4. **Sumá otra página** si el documento tiene más de una. Se repite el ciclo.
5. **"Agregar a la nota".** Con una sola página entra una imagen JPG. Con varias, Notes arma un único PDF con todas, en el orden en que las sacaste.

Todo el recorte y la limpieza se hacen en tu navegador, antes de subir el archivo. El tope de subida del escaneo es de 100 MB. Si lo pasás, el diálogo se queda abierto con tus páginas para que saques alguna y pruebes de nuevo.

## Un título que se pueda buscar

Una nota llamada "Escaneo 1 nov 2026, 10:42" es el nombre que Notes pone por defecto. Cambialo en el momento. Una fórmula que sirve para casi todo:

`Proveedor, qué es, mes y año`

Por ejemplo: "Electrodomésticos Sur, heladera, garantía, nov 2026". Dentro de la nota, escribí una línea con el importe, la fecha de vencimiento de la garantía y lo que esperabas hacer con eso. Esa línea es texto de verdad, y la búsqueda de Notes lo lee siempre, sin depender de nada más.

## Libretas y etiquetas para papeles

No hace falta un sistema aparte. Si ya seguís el esquema de [cuatro libretas y pocas etiquetas](/blog/organizar-notas-libretas-y-etiquetas), los papeles van en Áreas (hogar, finanzas, salud) o en Archivo cuando ya no importan.

Para filtrar rápido, una lista corta de etiquetas:

- `ticket`, `garantia`, `contrato`, `impuestos` como tipos.
- El año, por ejemplo `2026`, para armar la carpeta del contador.
- `revisar` para lo que escaneaste y todavía no nombraste.

Notes pasa las etiquetas a minúsculas y cambia los espacios por guiones. Conviene escribirlas sin tilde, para no tener `garantia` y `garantía` como dos etiquetas distintas.

## Qué lee Notes del texto de un escaneo

Esta parte necesita precisión, porque es donde las promesas se inflan.

- **PDF con texto.** Si el PDF ya tiene capa de texto (una factura bajada del sitio del proveedor), Notes la lee en el servidor, sin usar ningún modelo, y la suma a la búsqueda. Vale para los PDF que agregues desde que existe la función.
- **Fotos y PDF escaneados.** Leer el texto de una imagen requiere un modelo con visión. Está apagado por defecto. Un administrador lo prende en los ajustes de Notes, y desde ese momento las imágenes y escaneos que se sumen se mandan al modelo de IA y gastan la cuota de IA del workspace. Los archivos anteriores no se leen, y las notas bloqueadas nunca entran.
- **Límite de tamaño.** Notes lee archivos de hasta 12 MB. Los que pasan ese tope no se pueden buscar, y la nota te avisa cuáles son.
- **Estado de la función.** Todavía no la probamos con un modelo real, así que no podemos decirte qué tal lee un ticket arrugado. Hasta que lo verifiquemos, tratá la búsqueda dentro de las fotos como un extra y no como el plan principal: el título y la línea de texto que escribiste son lo que garantiza que lo encuentres.

Si el contenido es sensible (documentos de salud, contratos), pensalo antes de prender la lectura: manda esos archivos a un proveedor de IA. Con Notes en tu propia instalación elegís qué modelo se usa y cuál es su configuración.

## Marcar y anotar

Para un contrato o un formulario que tenés que completar, Notes tiene "Anotar imagen o PDF": lápiz, resaltador, recuadros y texto, y guarda una copia con las marcas sin tocar el original. Sirve para señalar la cláusula que querés consultar o para completar un formulario a mano.

## La rutina de diez minutos por semana

Digitalizar todo en un día no funciona. Funciona un hábito corto:

1. **Durante la semana:** el papel que importa va a una bandeja, sin pensar.
2. **El mismo día de la semana:** escaneás la bandeja. Un documento por nota, varias páginas en un solo PDF.
3. **Nombre y etiquetas** en el momento, mientras todavía te acordás qué es.
4. **Tirá o guardá:** los papeles con valor legal (escrituras, contratos originales, títulos) se conservan aunque los hayas escaneado. El resto se tira.
5. **Una vez por mes:** filtrá por `revisar` y por notas sin libreta, y terminá de ordenar.

## Lo que Notes todavía no hace

- **No hay importador de Evernote.** Si tenés años de notas allá, hoy la migración es manual.
- **No hay exportación de notas** con un botón. Si hosteás zerosoft, los datos están en tu base, pero eso no es un botón.
- **No hay un escáner de ticket que extraiga importe y proveedor** en campos. El texto queda en la nota y vos escribís los datos que te importan.
- **No hay recorte automático garantizado.** La detección de bordes ayuda, pero a veces hay que mover las esquinas a mano.
- **Las notas son personales.** Compartís una con un link, pero no hay libretas compartidas para editar en equipo.

## Para pegar en la heladera

- Se digitaliza lo que podés necesitar probar.
- Papel liso, luz de costado, teléfono paralelo.
- Escanear, ajustar esquinas, varias páginas a un PDF.
- Título: proveedor, qué es, mes y año.
- Una línea de texto con importe y fechas.
- Diez minutos por semana, siempre el mismo día.
