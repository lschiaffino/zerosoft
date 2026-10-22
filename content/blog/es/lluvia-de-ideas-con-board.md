---
title: "Lluvia de ideas con tu equipo: guion de 60 minutos con stickies, timer y votos ocultos"
description: "Cómo correr una sesión de ideas en Board: pregunta bien armada, ronda de escritura en silencio, agrupado, votación con puntos y stickies que terminan como issues en Track."
date: "2026-10-22"
author: "zerosoft"
tags: ["board", "miro", "talleres"]
---

Miro publica una [guía para conducir una sesión de brainstorming](https://miro.com/brainstorming/how-to-conduct-a-brainstorming-session/) pensada alrededor de su propio tablero. Un equipo de cinco personas necesita bastante menos que eso: una pregunta clara, una pizarra, un reloj y una forma de decidir qué ideas siguen.

Esta es una versión para correr en Board, la pizarra de zerosoft. Cada paso usa algo que Board hace hoy, y al final hay una sección con lo que no hace.

## La pregunta importa más que la pizarra

Una sesión de ideas falla casi siempre por la consigna. "Ideas para mejorar el producto" produce cuarenta tarjetas que nadie puede comparar. Una buena pregunta tiene un sujeto, un verbo y un límite:

- Mal: "Ideas de marketing".
- Mejor: "¿Cómo conseguimos 20 reservas de demo en octubre sin gastar en anuncios?"
- Mal: "Mejoras del onboarding".
- Mejor: "¿Qué le sacaríamos al primer día de una persona nueva para que llegue a su primera tarea en una hora?"

Escribí la pregunta en el chat del equipo antes de la reunión. Si no entra en una línea, es dos sesiones.

## Armá la pizarra

En la lista de Board, abrí **Empezar con una plantilla** y elegí **Lluvia de ideas**. Trae un tema central en una elipse y seis ideas de ejemplo unidas con líneas. Reemplazá el tema por tu pregunta.

Las seis ideas de ejemplo se borran. Para esta sesión conviene otra disposición: dibujá cuatro o cinco rectángulos vacíos con un título cada uno, según los ángulos que quieras cubrir ("canales", "contenido", "producto", "alianzas"). Sirven de zonas de agrupado más adelante. Si el tema no tiene ángulos obvios, dejá la pizarra libre y agrupá después.

Pasá el link a quien participe. Por defecto, cualquier miembro del workspace abre y edita la pizarra. Si vas a invitar a alguien de afuera, el panel de acceso permite crear un link de invitado con edición, que se apaga cuando termina la sesión.

## Ronda 1: escribir en silencio (10 minutos)

Abrí **Taller**, elegí **5 min** en el temporizador y tocá **Empezar**. Todos ven la cuenta regresiva en su pantalla; Board la calcula con la hora del servidor, así que no depende del reloj de cada máquina. El timer lo arranca alguien que pueda editar la pizarra, y con **+1 min** o **Pausar** se ajusta sin cortar la ronda.

Durante esos cinco minutos nadie habla. Cada persona crea sus ideas con la herramienta **Stickies**:

1. Elegí un color. Conviene un color por persona o por ángulo, y avisarlo antes.
2. Agregá un sticky y escribí una idea con un verbo. Cada sticky admite hasta 500 caracteres, y es mejor que sean pocos.
3. Poné tags con `#` si ya sabés de qué ángulo es (hasta 8 por sticky).

Escribir en silencio evita que la primera idea que se dice en voz alta ancle a todas las demás, y le da el mismo espacio a quien habla menos.

Una variante útil: si alguien llega con una lista armada en una nota o una planilla, que use **Pegar una lista**. Un sticky por línea, hasta 100 por pegado, y las palabras con `#` se vuelven tags. Una línea como `Webinar mensual con clientes #contenido` queda como sticky con el tag `contenido`.

Después de la ronda, hacé una segunda de dos minutos para "mejorar la idea de otra persona": cada uno suma un sticky que desarrolla o corrige uno ajeno. Es donde aparecen las ideas que nadie tenía solo.

## Ronda 2: agrupar (10 minutos)

Una persona comparte pantalla y arrastra. Es la única que edita en este tramo, para no pisarse.

Reglas para agrupar:

- Juntá lo que resuelve lo mismo, aunque esté escrito distinto.
- Si dos stickies son iguales, dejá uno y borrá el otro. El autor no se ofende: la idea sigue ahí.
- Cada grupo recibe un título de tres palabras como máximo.
- Un sticky que no encaja en nada queda aparte. Se mira al final.

El panel de Stickies lista los tags de la pizarra y permite seleccionar de una vez todos los que comparten uno. Si usaron tags, agrupar lleva dos minutos.

## Ronda 3: votar con votos ocultos (10 minutos)

En **Taller**, abrí una **votación con puntos**. Elegís cuántos votos tiene cada persona, de 1 a 20. Una regla razonable es un tercio de las ideas que quedaron en pie, con un mínimo de tres: con 18 stickies, seis votos.

Mientras la votación está abierta, cada uno ve solo sus propios votos y el panel muestra cuántas personas ya votaron, sin decir por qué. Se vota con el botón **+** sobre cada sticky, y se puede poner más de un voto en el mismo. Al **cerrar y ver resultados** aparecen los totales por sticky, de más a menos.

Que los votos queden ocultos hasta el cierre cambia el resultado: nadie vota por lo que ya está ganando ni por lo que votó la persona con más antigüedad. Si el empate en el tercer puesto es real, desempatan hablando, no con una segunda votación.

## Cierre: de stickies a trabajo (15 minutos)

Elegí las dos o tres ideas más votadas y respondé tres preguntas por cada una: quién la lleva, qué hace en la primera semana y cómo sabemos si funcionó.

Después seleccioná esos stickies, abrí el botón **Track** de la barra y elegí el proyecto. Board crea un issue por sticky, con el texto de la idea y un link de vuelta a la pizarra. Un sticky que ya tiene issue no se duplica, y el estado y el responsable del issue aparecen debajo del sticky, así que la pizarra queda como mapa de lo que avanzó. Lo detallamos en el [flujo de acciones de la retro](/blog/retro-en-una-pizarra); acá funciona igual.

Dejá la pizarra como está. El historial guarda una versión por hora durante 30 días y se restaura como copia, por si alguien limpia de más.

## El guion en una tabla

| Minutos | Qué pasa | Herramienta |
|---|---|---|
| 0 a 5 | Se lee la pregunta y se reparten colores | Plantilla Lluvia de ideas |
| 5 a 15 | Ideas en silencio y ronda de mejora | Taller: timer 5 + 2 min, Stickies |
| 15 a 25 | Agrupado | Tags, selección por tag |
| 25 a 35 | Votación oculta | Taller: votación con puntos |
| 35 a 50 | Las 2 o 3 primeras: dueño, primera semana, señal de éxito | Comentarios en el lienzo |
| 50 a 60 | Issues en Track | Botón Track |

## Lo que Board no hace todavía

Board no tiene edición en vivo con cursores: no ves moverse a las demás personas. Si dos guardan a la vez, los cambios se combinan elemento por elemento, y si uno editó algo que el otro borró, el aviso te pide elegir. El timer y la votación se actualizan consultando al servidor cada pocos segundos, no con una conexión abierta, así que puede haber un retraso de unos 4 segundos. No agrupa stickies con IA ni tiene un modo para que las ideas aparezcan de a una. Para la ronda en silencio, la regla del equipo reemplaza a la herramienta.

## Cuánto cuesta

Miro Starter cuesta [$8 por miembro por mes con facturación anual](https://miro.com/pricing/), y el plan Free incluye [tres tableros editables](https://miro.com/pricing/). Tiene lo que acá falta: cursores en vivo, agrupado con IA y miles de plantillas.

Board cuesta $0 si lo corrés en tu servidor, y en zerosoft Cloud los asientos no se cobran. Para un equipo que hace una sesión por mes y quiere que las ideas terminen en un proyecto de Track, alcanza.
