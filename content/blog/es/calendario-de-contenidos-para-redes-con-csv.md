---
title: "Calendario de contenidos para redes: plantilla CSV y Social"
description: "Armá el calendario de contenidos del mes en una planilla, importalo a Social como programadas, para aprobar o borradores, y dejá que la cola ocupe los huecos."
date: "2026-11-21"
author: "zerosoft"
tags: ["social", "hootsuite", "guía"]
---

Un calendario de contenidos es una lista de lo que vas a publicar, en qué red y qué día. Hootsuite lo explica en [su guía](https://blog.hootsuite.com/how-to-create-a-social-media-content-calendar/) como un plan que puede vivir en una planilla, en un documento o en una herramienta de proyectos. Estamos de acuerdo en lo básico. Lo que cambia es dónde termina esa lista: en una plantilla que descargás tras completar un formulario, o en tu propia herramienta, con tus datos, lista para salir.

Esta guía arma el calendario de un mes en una planilla que vos controlás y la importa a Social, la app de redes de zerosoft.

## Antes de empezar: el estado de Social

Social todavía figura como "Próximamente" en el sitio. Las redes (Facebook, Instagram, LinkedIn, X, TikTok, YouTube, Threads y Bluesky) están hechas sobre las APIs oficiales y probadas contra redes simuladas. Con cuentas reales todavía no las verificamos, y varias necesitan la app de desarrollador de quien administra la instancia. Si hospedás zerosoft vos, eso es parte del trabajo. El detalle fila por fila está en la tabla de paridad de [Social](/products/social).

Todo lo que sigue se puede probar hoy con las redes simuladas. El flujo de la planilla es el mismo cuando conectes cuentas reales.

## Paso 1: decidí tres cosas antes de escribir una fila

1. **Cuántas veces por semana, por red.** Elegí un número que tu equipo pueda sostener. Tres publicaciones por semana en dos redes son 24 filas al mes. Cuatro redes a diario son 120 y alguien va a abandonar en la semana dos.
2. **Pilares.** Tres o cuatro temas que se repiten: producto, clientes, detrás de escena, ideas del rubro. Sirven para que el calendario no se llene de lo primero que se te ocurre.
3. **Quién aprueba.** Si alguien del equipo necesita que otro revise sus publicaciones, definilo ahora (más abajo, en el paso 5).

## Paso 2: la planilla

Social lee un CSV con estas columnas: fecha, hora, texto y link (opcional). Con encabezado el orden da igual, y los nombres se reconocen en español, inglés y portugués (`fecha`, `hora`, `texto`, `link`). Sin encabezado, el orden es el de arriba. El separador puede ser coma o punto y coma, así que el CSV que exporta una planilla en español funciona tal cual.

Una plantilla para empezar:

```
fecha,hora,texto,link
2026-12-01,09:30,"Lanzamos la versión de diciembre: lo que cambió en el calendario.",https://tusitio.com/novedades
2026-12-03,18:00,"Tres preguntas que nos hacen siempre antes de contratar.",
2026-12-08,09:30,"Cómo trabaja el equipo un lunes: nuestra reunión de 15 minutos.",
```

Reglas que conviene saber, tomadas del código del importador:

- **La hora va en la zona horaria del workspace.** Una fecha sin hora es un error: no se adivina.
- **Formatos de fecha.** `2026-12-31` siempre se entiende. Con barras (`03/04/2026`) hay que elegir al importar si es día primero o mes primero.
- **Hasta 350 filas por archivo** y 2 MB. Lo que sobra queda afuera y te lo avisa.
- **El link se suma al final del texto** si el texto no lo trae ya.
- **No hay fotos por fila.** Un CSV trae solo texto.

Podés sumar columnas propias (pilar, responsable, objetivo): las que Social no reconoce se ignoran, así que tu planilla puede ser más rica que lo que se importa.

## Paso 3: importá y mirá la vista previa

En Social, abrí **Importar CSV**. Elegí las cuentas (cada fila sale en todas las que marques), subí el archivo o pegá las filas, y miralo en **Vista previa**. Cada fila queda en "Lista" o "Se saltea", con el motivo:

- la fecha o la hora no se entienden,
- esa fecha y hora ya pasaron,
- no tiene texto ni link,
- el link no es una URL válida.

También se avisan los problemas por red, como un texto que pasa el límite de caracteres de X. Arreglá la planilla y volvé a cargarla, o importá lo que está bien y salteá lo demás.

## Paso 4: elegí cómo entra

El selector **Importar como** tiene tres opciones:

- **Publicaciones programadas:** salen solas en la fecha y hora de cada fila.
- **Publicaciones para aprobar:** quedan en la pestaña "Para aprobar" hasta que un admin las revise.
- **Borradores:** no salen. Es lo que tenés que usar cuando la publicación lleva foto o video, porque el CSV no los trae. Abrís cada borrador en el compositor, sumás el archivo (hasta 10 MB) y lo programás.

Para el primer mes, mi sugerencia es importar como borradores o para aprobar, revisar el calendario completo en vista de mes y recién ahí programar. Las programadas se pueden arrastrar a otro día en el calendario, y conservan la hora.

## Paso 5: aprobaciones para quien las necesita

Los miembros con el rol "Necesita aprobación" mandan sus publicaciones a revisión en lugar de programarlas. Un admin las aprueba o las rechaza con un comentario, y quien las escribió recibe el aviso. Cada publicación guarda quién la aprobó. Lo que todavía no existe son las aprobaciones de varios pasos: es una sola revisión.

## Paso 6: la cola para los huecos

Un calendario de fechas fijas no cubre todo. Para contenido que puede salir cualquier día, cada cuenta tiene **Horarios de la cola** (en la pantalla Cuentas): días de la semana y horas en que querés que salgan cosas. En el compositor, la opción **Sumar a la cola** toma el próximo horario libre de esa cuenta y te muestra cuál es antes de confirmar. Si la cuenta no tiene horarios, te lo dice.

Una combinación que funciona: el CSV con las publicaciones que tienen fecha (lanzamientos, eventos) y la cola para el contenido que siempre sirve.

## Paso 7: revisá una vez por semana

Con 10 publicaciones con métricas, Social sugiere mejores horarios a partir de tus propias interacciones. Antes de eso muestra horarios para empezar, marcados como tales. Tomala como una sugerencia: dos o tres semanas de datos de un equipo chico dicen poco.

Si ponés los links por el acortador de la suite, Link cuenta los clics y Social puede agregar los parámetros UTM. Cómo armarlos: [UTMs sin planilla](/blog/utms-sin-planilla).

## Qué falta, para que no te sorprenda

- Pinterest, Google Business Profile e historias de Instagram y Facebook todavía no.
- No hay editor de imágenes ni integración con Canva.
- Las publicaciones de X admiten texto y hasta cuatro fotos, sin video.
- La búsqueda de hashtags en tendencia no existe. Hay grupos guardados y sugerencias a partir de lo que tu equipo ya usó.

## Costos

Self-host: $0, con todas las funciones del core bajo AGPL. En zerosoft Cloud no se cobran asientos, así que sumar a alguien para que revise no cambia la factura. Si venís de Hootsuite, la comparación completa está en [Hootsuite vs zerosoft Social](/compare/hootsuite-alternative).
