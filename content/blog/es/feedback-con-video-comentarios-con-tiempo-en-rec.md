---
title: "Dar feedback en video: una revisión de 3 minutos con Rec"
description: "Cómo dar una revisión de diseño o de código en un video corto, con una estructura que se entiende sin reunión, y cómo llevarla en Rec con comentarios con tiempo, acceso restringido y un issue de Track."
date: "2026-11-16"
author: "zerosoft"
tags: ["rec", "feedback", "asincrónico"]
---

Un comentario de texto sobre un diseño dice "el espaciado se siente raro". Quien lo recibe pregunta "¿dónde?", y la conversación que iba a ahorrar una reunión termina en tres idiomas de ida y vuelta. Un video de tres minutos donde señalás la pantalla resuelve eso, siempre que el video tenga estructura.

Loom tiene [una guía de buenas prácticas para dar feedback en video](https://www.loom.com/blog/best-practices-for-providing-feedback-via-loom). Este post parte del mismo problema y propone un método que podés copiar hoy, con las partes de Rec que lo sostienen y lo que todavía no hace.

## Cuándo conviene video y cuándo texto

Video cuando el feedback es visual o secuencial: un diseño, un flujo de pantallas, un pull request grande, una landing con varios problemas. Texto cuando es una corrección puntual de una línea. Una regla práctica: si necesitarías decir "mirá acá" más de dos veces, grabá.

Y un límite: si la persona va a discrepar con fuerza, el video no reemplaza una llamada. Sirve para llegar a la llamada con los puntos ya mostrados.

## La estructura de una revisión de 3 minutos

Una estructura fija hace que quien mira sepa qué viene y pueda saltar.

1. **Veredicto en los primeros 15 segundos.** "Está casi listo, hay dos cambios obligatorios y tres sugerencias." Quien tiene prisa puede cerrar el video ahí.
2. **Obligatorios primero.** Cada uno con lo que ves, por qué importa y qué cambiarías. Una frase por cada parte.
3. **Sugerencias después.** Decí explícitamente que son opcionales. Evita que alguien pase una hora en algo que querías como comentario al pasar.
4. **Cierre con el siguiente paso.** Quién hace qué y para cuándo. Si no hay pedido concreto, el video queda como una opinión.

Una plantilla para el guion, en tus propias palabras:

```
Veredicto: [listo / casi listo / hay que rehacer]
Obligatorio 1: [dónde] [qué veo] [qué cambiaría]
Obligatorio 2: ...
Sugerencias: [dónde] [idea]
Siguiente paso: [persona] [acción] [fecha]
```

Grabá una toma. Si te equivocás, empezá de nuevo en lugar de editar: una revisión con una pausa o un "perdón, quise decir" sigue siendo más clara que un hilo de texto.

## Cómo grabarlo en Rec

Rec graba desde el navegador: pantalla, cámara o las dos a la vez, con la burbuja de la cámara dibujada en el video. Podés elegir pantalla completa, ventana o pestaña. Hay cuenta regresiva de 3 segundos al empezar, pausa, empezar la toma de nuevo y silenciar el micrófono.

Dos detalles que ayudan en una revisión:

- **Grabá la pestaña, no la pantalla entera**, si el material está en el navegador. Así no se cuela una notificación ajena.
- **Una toma por tema.** Si revisás un diseño y un documento, hacé dos videos. Después es más fácil enlazar cada uno donde corresponde.

El video se sube por partes mientras grabás y el link se copia apenas cortás. Si se cae la red, la grabación sigue y reintenta sola.

Lo que Rec todavía no tiene: dibujar sobre la pantalla ni resaltar el mouse mientras grabás. Para señalar, mové el cursor despacio y decí en voz alta dónde estás. Tampoco hay extensión de Chrome; hay una app de escritorio para Mac y Windows.

## Cerrar el circuito: comentarios con tiempo

Lo que hace útil al video como feedback es que la respuesta apunte al segundo exacto. En Rec, los comentarios quedan marcados en la línea de tiempo: un clic lleva al segundo, y al pasar por la marca el comentario aparece sobre el video. También hay seis reacciones con emoji, ancladas al segundo.

Pedile a quien recibe la revisión que responda ahí y no por chat. Dos razones: cada respuesta queda pegada al momento que discute, y vos recibís un aviso agrupado ("3 comentarios nuevos") en lugar de tres mensajes sueltos. Las respuestas son de texto; todavía no se puede responder con otro video.

## Quién puede verlo

Un feedback sobre un diseño sin lanzar o sobre código interno no debería estar abierto al mundo.

- Lo nuevo nace **restringido**: solo quien grabó y las personas invitadas. Podés pasar a miembros del workspace o a cualquiera con el link.
- Podés **invitar por email** como lector o comentador. Quien es de afuera recibe un link de un solo uso.
- Podés poner **contraseña** y **vencimiento**, y bloquear la descarga. Ojo con esto último: el video se sigue transmitiendo, así que alguien decidido puede capturarlo. Bloquear la descarga frena el reenvío por descuido.

## De la revisión a la tarea

Una revisión que no termina en trabajo asignado se olvida. Desde el video, con un clic, Rec crea un issue de Track o una página de Docs con el link, el resumen de IA, los capítulos y la transcripción. El texto se copia tal cual, sin reescribirlo.

La transcripción, el resumen y los capítulos dependen de que haya un proveedor de transcripción configurado y de la cuota de IA del workspace. Si lo corrés vos mismo, definís vos cuál (variable `REC_TRANSCRIBE_PROVIDER`). Sin eso, el video funciona igual, pero sin texto.

El flujo completo queda así: grabás la revisión, la compartís restringida a quien corresponde, la persona comenta sobre el segundo exacto y vos convertís los obligatorios en issues de Track. Si lo que querés sacar de tu agenda es la reunión de revisión, [una nota de reunión que termina en tareas](/blog/notas-de-reunion-que-terminan-en-tareas) sigue la misma lógica.

## Por qué importa dónde vive el video

Un video de revisión suele mostrar cosas que no querés en un servicio ajeno: pantallas de producto sin lanzar, datos de clientes en un panel, código. Con Rec en self-host, los archivos quedan en el almacenamiento de tu instalación y pagás solo ese almacenamiento. En zerosoft Cloud se cobra por uso y los asientos no cuestan.

Es un producto nuevo y está lejos de tener todo lo de Loom: no hay edición con IA de muletillas, ni app móvil, ni grabación de reuniones. Podés ver la lista completa y actualizada en la página de comparación de Rec.

## Resumen

- Video para feedback visual o secuencial, texto para cambios de una línea.
- Veredicto primero, obligatorios, sugerencias, siguiente paso.
- Una toma por tema, tres minutos como tope.
- Comentarios con tiempo para responder, acceso restringido por defecto.
- Los obligatorios se convierten en issues de Track antes de cerrar la pestaña.
