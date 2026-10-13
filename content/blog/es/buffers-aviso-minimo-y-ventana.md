---
title: "Higiene de agenda: buffers, aviso mínimo y ventana de reservas"
description: "Un link de reservas vale lo que valen las reglas que tiene atrás. Guía práctica de disponibilidad semanal, buffers, aviso mínimo, ventana de reservas y blocked slots en Cal, y por qué importa cada uno."
date: "2026-08-17"
author: "Zerosoftware"
tags: ["cal", "agendar", "productividad"]
---

La mayoría de los dolores de agenda no los causa la herramienta. Los causa un link de reservas que dice "sí" a cosas que nunca aceptarías en persona: una llamada que arranca en el minuto en que termina la anterior, una reunión reservada para dentro de 20 minutos, una demo a cuatro meses que nadie va a recordar.

Cada una de esas cosas tiene un ajuste. Acá va qué hace cada regla en Cal, cómo funciona por dentro y los valores que te sugerimos. Diez minutos de configuración te ahorran un montón de reprogramaciones incómodas.

## Paso cero: configurá tu zona horaria

Antes que nada: **Cal → Settings → Timezone.** Una cuenta nueva de Cal arranca en **UTC**. Cal no adivina tu zona desde el navegador para este ajuste, porque tu disponibilidad no debería cambiar en silencio cuando abrís la laptop en otro país.

Por qué importa: tus horarios semanales se interpretan en esa zona. Si ponés "9:00 a 17:00" y dejás UTC mientras vivís en Buenos Aires, vas a estar ofreciendo slots de 6:00 a 14:00 de tu hora. Los invitados siempre ven los horarios en *su* zona, así que nadie lo va a notar hasta que alguien te reserve a las 6:30 de la mañana.

Configuralo una vez. Después mirá tu página pública en una ventana privada para confirmar que los horarios tienen sentido.

## Disponibilidad semanal

La disponibilidad se configura **por event type**, como reglas de "día de la semana + hora de inicio + hora de fin". Podés poner varias reglas el mismo día, y así se arma el hueco del almuerzo: lunes 9:00–12:30 y lunes 14:00–18:00.

Que sea por event type es a propósito. Tu slot de 15 minutos para "una consulta rápida" puede estar abierto todo el día, mientras que el workshop de 60 minutos solo corre martes y jueves a la tarde. Una persona, distintas puertas.

Un detalle que se pasa por alto: **los slots se cortan según la duración del evento, desde el inicio de cada ventana.** Un evento de 30 minutos en una ventana de 9:00–12:00 ofrece 9:00, 9:30, 10:00… Uno de 45 minutos ofrece 9:00, 9:45, 10:30, 11:15, y ahí se corta, porque no entra otro antes de las 12:00. Si querés reuniones de 45 minutos en horas redondas, armá las ventanas en consecuencia.

## Buffers

Los buffers son colchones antes y después de una reunión: **Buffer before (min)** y **Buffer after (min)**.

Así los usa Cal: para cada slot candidato, estira el slot con los buffers (10:00–10:30 con 10 minutos después pasa a ser 10:00–10:40) y compara ese rango estirado contra todo lo que te tiene ocupado: otras reservas de Cal (de cualquier event type), blocked slots y tu Google Calendar si está conectado. Si algo se pisa, el slot desaparece.

Por qué los querés:

- **Las llamadas se estiran.** Una de 30 minutos que dura 35 no debería hacerte llegar tarde a la siguiente.
- **Necesitás anotar cosas.** Notas, actualizar el CRM, un mail de seguimiento. Ese es el trabajo de verdad.
- **Cambiar de contexto cuesta.** Un buffer de 5–10 minutos es el truco de productividad más barato que existe.

Una sutileza, directo del código: **Cal acolcha la reunión que se está reservando, no lo que ya está en tu calendario.** Las reservas existentes y los eventos de Google se comparan tal cual. Entonces, si solo ponés un buffer *después*, una llamada de 10:00–10:30 protege el tiempo posterior solo si la reunión siguiente ya existía al momento de reservarla. Si alguien reserva las 10:00 primero y después otra persona viene por las 10:30, el buffer posterior de ese slot no mira para atrás, y quedás pegado.

La solución es simple: **si querés un hueco garantizado entre dos reuniones cualesquiera, poné el mismo valor antes y después.** Así, la reunión que se reserve segunda lleva el hueco del lado que toca a la primera. Ojo que esto también ralea los slots: con slots de 30 minutos y 10 de cada lado, reservar las 10:00 esconde las 10:30, y la próxima opción libre es 11:00.

Sugerencia: 10 minutos antes y después para llamadas de ventas y soporte; más del lado de antes para reuniones que requieren preparación, como entrevistas (releer el CV) o demos (cargar los datos correctos).

## Aviso mínimo

**Min. notice (hours)** evita que te reserven una reunión que arranca demasiado pronto. Con 4 horas de aviso, a las 10:00 el primer slot reservable es a las 14:00.

Es un cálculo directo de "ahora más N horas", así que no le importan noches ni fines de semana. Con 12 horas, a las 20:00 del viernes alguien todavía puede reservar el sábado a las 8:00, si el sábado está en tu disponibilidad. Si no trabajás los fines de semana, asegurate de que tus reglas semanales lo digan.

Por qué importa: una reunión que aparece en tu calendario 15 minutos antes de empezar es una reunión a la que probablemente faltes o llegues sin preparar. Sugerencia: 2–4 horas para llamadas más informales, 12–24 horas para demos y entrevistas.

## Ventana de reservas

**Max. future (days)** pone un tope a qué tan adelante te pueden reservar. Por defecto: 30 días, contados desde hoy en la zona horaria del invitado.

¿Por qué limitarla? Porque las reuniones reservadas muy a futuro tienen más ausencias y chocan con planes que todavía no hiciste: vacaciones, una conferencia, un lanzamiento. Una ventana de 2–4 semanas hace que tu calendario refleje la realidad. Recruiting y demos de ventas suelen andar bien con 14–21 días. Office hours u onboardings quizás quieran 60.

## Blocked slots

Los blocked slots son bloques puntuales en los que no estás disponible: el médico, una media jornada fuera de la oficina, una semana de vacaciones. Se agregan desde la página principal de Cal, con inicio, fin y un motivo opcional.

A diferencia de la disponibilidad semanal, los blocked slots son **tuyos**, no de un event type. Sacan esas horas de todas tus páginas de reserva, incluidos los pools de round-robin de los que formás parte.

Si tenés Google Calendar conectado, muchas veces no los necesitás: los eventos de tu calendario principal ya bloquean slots, porque Cal consulta tu free/busy antes de mostrar horarios. Los blocked slots son para lo que no anotás en el calendario, o para cuando preferís no conectar ninguno.

## Reglas del event type vs. defaults de la cuenta

Buffers, aviso mínimo y ventana aparecen en dos lugares:

- **Cal → Settings → Defaults for all event types**,
- las **Booking rules** de cada event type.

Cuando el event type tiene su propio valor, gana ese. Cuando no, Cal usa el default de la cuenta. En la práctica, los event types creados desde el editor guardan sus propias reglas, así que **tomá las reglas del event type como la fuente de verdad** y revisalas en cada uno. Los defaults de la cuenta pesan sobre todo en event types creados por API sin reglas.

## Dos herramientas más

**Links de un solo uso.** Marcá un event type como single-use y el link sirve para exactamente una reserva. Después, la página avisa que ya se usó. Ideal para "este link es para *vos*": una entrevista con un candidato, un cliente VIP.

**Tu calendario es parte de tu disponibilidad.** Todas las reglas de arriba funcionan tan bien como los datos que tienen atrás. Si estás en un equipo que usa [round-robin](/blog/round-robin-con-cal), un host sin calendario conectado parece libre siempre que Cal no sepa lo contrario.

## Una configuración para arrancar

Si querés algo para copiar, esta es una base razonable para un consultor independiente hipotético:

- Zona horaria: la tuya de verdad (no UTC).
- Disponibilidad: lunes a jueves, 9:30–12:30 y 14:00–17:30. Viernes libre.
- Buffers: 10 minutos antes y 10 después.
- Aviso mínimo: 12 horas.
- Ventana: 21 días.
- Google Calendar conectado, blocked slots para lo que no está en el calendario.

Nada de esto es avanzado. Es higiene. De la que solo notás cuando falta: normalmente a las 6:30 de la mañana, en una llamada que no sabías que tenías.
