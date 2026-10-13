---
title: "Cómo maneja Cal las zonas horarias: hora de reloj, UTC y horario de verano"
description: "Recorrido de ingeniería por las zonas horarias en Cal: qué guardamos en UTC, qué guardamos como hora de reloj, cómo los slots sobreviven al horario de verano y cómo los mails y el .ics llegan en la hora del invitado."
date: "2026-09-01"
author: "Zerosoftware"
tags: ["cal", "arquitectura", "zonas horarias"]
---

Las zonas horarias son la parte de una herramienta de agenda que parece trivial y no lo es. "¿Tus 15 son mis 15?" tiene una docena de respuestas incorrectas, y la mayoría solo aparece dos veces por año, cuando en algún lugar del mundo cambia el horario de verano.

Este post cuenta cómo lo resuelve Cal, basándonos estrictamente en lo que hace el código: `lib/calendar.ts`, `lib/ics.ts`, `lib/user-tz.ts` y compañía. Sin librería de zonas horarias: solo `Intl` y dos reglas.

## Las dos reglas

**1. Los instantes se guardan en UTC.** El `starts_at` y `ends_at` de una reserva se escriben con `toISOString()`. Blocked slots, el `send_at` de los recordatorios, todo lo que es *un momento en el tiempo* va en UTC.

**2. Las intenciones se guardan como hora de reloj.** Tu disponibilidad semanal no se guarda en UTC. Se guarda como "día de la semana + `09:00` + `17:00`", más la zona horaria de tu cuenta como nombre IANA, tipo `America/New_York`. Eso es lo que realmente querés decir: "trabajo de 9 a 17 donde vivo", no "trabajo de 13:00 a 21:00 UTC".

La regla 2 es la que convierte el horario de verano en un no-evento. Si convirtiéramos tu disponibilidad a UTC al guardarla, cada marzo y cada noviembre tus horas de trabajo se correrían una hora sin aviso. En cambio, convertimos al consultar, para la fecha específica que se pide. Un lunes de verano, las 9:00 en Nueva York son las 13:00 UTC; un lunes de invierno, las 14:00 UTC. Misma regla, respuesta correcta las dos veces.

## Tres zonas horarias en juego

En Cal hay tres zonas horarias distintas, y mantenerlas separadas es la mitad del trabajo:

- **La zona del host.** Se configura en los settings de Cal y se valida como zona IANA real (si `Intl.DateTimeFormat` la rechaza, la API también). Las cuentas nuevas arrancan en UTC: no la inferimos en silencio, así tu disponibilidad nunca se mueve porque viajaste.
- **La zona del invitado.** La página de reserva la lee del navegador con `Intl.DateTimeFormat().resolvedOptions().timeZone`, y el invitado la puede cambiar desde un desplegable. Se guarda en la reserva.
- **La zona de quien mira la app.** Adentro de la app, un componente chico escribe la zona de tu navegador en una cookie `tz`, para que paneles como "reservas de esta semana" se vean en tu hora. Fuera de una request (crons, tests) cae a UTC.

## Armar slots entre dos calendarios

Acá viene lo interesante. Una invitada en Tokio pide slots para el 10 de septiembre. El host está en Buenos Aires, con disponibilidad de lunes a viernes de 9:00 a 18:00. Tokio va 12 horas adelante, así que el 10 de septiembre de la invitada abarca dos días del host.

`getAvailableSlots` lo resuelve así:

1. Calcula el día de la invitada como rango UTC: medianoche del 10 en Tokio, más 24 horas.
2. Recorre los días locales **del host** desde un día antes hasta un día después de ese rango. Cada paso salta a la siguiente medianoche local en la zona del host, calculada de nuevo, así un día de 23 o 25 horas no lo desarma.
3. Para cada día del host, busca el día de la semana *en la zona del host*, aplica las reglas de disponibilidad que correspondan y convierte el inicio y fin de cada regla a UTC para esa fecha.
4. Corta slots según la duración del evento y descarta los que caen fuera del día de la invitada, los que están dentro del aviso mínimo y los que chocan (con buffers) con algo ocupado.
5. Ordena y elimina duplicados.

Después, el navegador de la invitada formatea cada instante UTC en su zona con `Intl`. El servidor nunca formatea un slot para mostrar: entrega instantes.

## Convertir hora de reloj a UTC sin librería

El helper central es `localToUtc(date, time, tz)`: "¿qué instante UTC son las 09:00 del 2026-09-10 en `America/Argentina/Buenos_Aires`?". JavaScript no trae nada para esa dirección. `Intl` solo va para el otro lado: dado un instante, decime la hora local.

Así que iteramos. Arrancamos haciendo de cuenta que la hora de reloj *es* UTC. Le preguntamos a `Intl` qué hora local es ese instante en la zona destino. La diferencia entre lo que queríamos y lo que obtuvimos es el offset; corremos el instante esa diferencia y volvemos a chequear. Normalmente se estabiliza en una o dos vueltas; el loop tiene un tope de cinco. Como el offset se mide en el instante real, los cambios de horario de verano se toman solos.

Son unas quince líneas, y significan cero dependencias y nada que actualizar cuando un país cambia sus reglas de horario de verano: de eso se ocupa la base de zonas horarias del runtime.

## Una semana de cambio de horario, en concreto

Hipotético: un host en Nueva York con disponibilidad de 9:00 a 17:00 y una invitada en Buenos Aires (sin horario de verano).

- Antes de que Estados Unidos pase al horario de verano, las 9:00 de Nueva York son las 11:00 en Buenos Aires.
- Después del cambio, las 9:00 de Nueva York son las 10:00 en Buenos Aires.

La invitada ve que los slots del host se adelantan una hora. Es correcto: el host sigue arrancando a las 9 en su vida. Una invitada en Madrid vería cambiar la diferencia dos veces, porque Estados Unidos y Europa cambian en fines de semana distintos. Otra vez correcto, y en la base no cambió nada.

## Validar la reserva

El cliente manda el instante elegido más la zona del invitado. El servidor no confía a ciegas en ninguno de los dos: `findOfferedSlot` vuelve a correr el mismo cálculo de slots para el día local del invitado y solo acepta un inicio que coincida con un slot ofrecido (con un minuto de tolerancia). Después la reserva se guarda con el instante UTC, la zona IANA del invitado y su idioma (`en`, `es` o `pt`).

## Mails, recordatorios y .ics

Todo lo que recibe el invitado se arma en **su** zona horaria y **su** idioma. Los mails de confirmación, reprogramación y cancelación formatean la hora con `Intl.DateTimeFormat` usando `en-US`, `es-AR` o `pt-BR`, en la zona de la reserva, con el nombre de la zona al lado ("(America/Sao_Paulo)") para que no haya ambigüedad. El link de gestión también apunta al idioma del invitado.

El recordatorio de 24 horas se programa como instante UTC (`inicio - 24h`) y lo manda el cron de `/api/cron/tick`, que corre cada hora, así que sale entre 24 y 23 horas antes de la reunión. Las reuniones reservadas con menos de 24 horas de anticipación no tienen recordatorio: la confirmación acaba de llegar.

El adjunto `.ics` esquiva el problema por completo: `DTSTART` y `DTEND` se escriben en UTC con una `Z` al final, tipo `20260910T120000Z`. No hay bloque `VTIMEZONE` que pueda salir mal. Gmail, Outlook y Apple Calendar convierten cada uno a la zona de su usuario. El `UID` es estable por reserva y `SEQUENCE` sube en cada cambio, así que una reprogramación actualiza el evento existente en vez de crear otro, y `METHOD:CANCEL` lo borra.

La sincronización con Google Calendar sigue la misma idea: los eventos se crean con horas UTC y Google los muestra en la zona de cada persona.

## La lista honesta de bordes

Cosas que conocemos y todavía no resolvimos del todo:

- **El mail al host muestra la zona del invitado.** Está rotulada, así que no hay ambigüedad, pero la conversión la hace el host. Si tenés Google Calendar conectado, el evento en tu calendario igual está en tu hora.
- **La línea de descripción del .ics está en inglés.** El mail que lo envuelve está traducido y el título del evento es el que escribió el host, pero la línea "Reschedule or cancel" dentro del `.ics` todavía no se traduce.
- **El día de cambio de horario del invitado se trata como de 24 horas.** El único día del año que en su zona dura 23 o 25 horas, un slot justo en la medianoche puede aparecer en la fecha vecina.
- **Reglas de disponibilidad dentro del hueco del cambio.** Una regla que arranca en una hora local que no existe (las 02:30 de la noche en que se adelanta el reloj) se resuelve a un instante cercano. Rara vez hay horario laboral ahí, pero no lo tratamos como caso especial.

Nada de esto es humo hipotético: sale directo del código de arriba, que es justamente la idea. Si encontrás otro, el código es abierto: [así podés contribuir](/blog/como-contribuir-a-zerosoftware).
