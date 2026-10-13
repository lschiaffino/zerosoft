---
title: "Round-robin con Cal: un solo link para todo el equipo"
description: "Cómo compartir un único link de reservas entre tu equipo de ventas o soporte con Cal, y cómo elige Cal al host de cada reunión: cursor, orden del pool, conflictos y todo."
date: "2026-07-18"
author: "Zerosoftware"
tags: ["cal", "agendar", "equipos"]
---

Tenés tres personas que pueden tomar una demo. No querés tres links de reserva en tu web, y mucho menos que alguien decida a mano quién se queda con cada lead. Querés un link, y que las reuniones se repartan entre el equipo.

Eso es round-robin. Cal lo hace, y como el código es abierto podemos hacer algo que la mayoría de las herramientas de agenda no hacen: mostrarte exactamente cómo se elige al host. Sin caja negra, sin copy de marketing sobre "distribución inteligente". Un cursor y un loop.

## Cómo configurarlo

El round-robin vive en el event type. Primero necesitás un equipo, porque el pool de hosts se arma con miembros del team.

1. Andá a **Cal → Event types** y creá (o abrí) el event type que querés compartir; por ejemplo, "Demo de producto", 30 minutos.
2. En la sección **Hosts (round-robin)**, marcá a los miembros del equipo que van a tomar estas reuniones. El formulario lo dice sin vueltas: las reservas rotan entre los miembros seleccionados.
3. Configurá la disponibilidad semanal del event type (abajo explicamos por qué importa).
4. Pedile a cada host que conecte su propio Google Calendar desde **Cal → Settings**. Es por persona, no por workspace, y es clave.
5. Compartí el link público: `/book/<tu-handle>/<slug>`.

Listo. Si dejás el pool vacío, el event type funciona como un link normal de una persona: el dueño hostea todas las reuniones.

Un pool admite hasta 50 hosts. Es un límite de validación de la API, no un plan de precios.

## Cómo se elige al host

Esto es lo que pasa de verdad, en orden, directo de `lib/calendar.ts`.

**1. Mostrar slots.** Cuando el invitado abre la página de reserva, Cal arma los slots candidatos a partir de la disponibilidad semanal del event type. Para cada slot revisa a cada host del pool. El slot se muestra si **al menos un** host está libre. Libre significa que el slot (más los buffers) no se pisa con:

- reservas confirmadas de ese host en **cualquier** event type (no solo este),
- sus blocked slots,
- los horarios ocupados de su Google Calendar conectado.

O sea, la página muestra la unión del tiempo libre de todos. Con tres hosts, el invitado ve muchas más opciones que con uno.

**2. Reservar.** Cuando el invitado confirma, Cal mira un contador persistente del event type, `rr_cursor`. Recorre el pool empezando en la posición del cursor (dando la vuelta si hace falta) y le asigna la reunión al **primer host libre** para ese slot exacto.

**3. Avanzar.** Después de guardar la reserva, el cursor avanza una posición.

El orden del pool es el orden de tu lista de miembros del equipo, filtrada a los que marcaste. No es alfabético por casualidad ni aleatorio.

## Qué significa en la práctica

Supongamos que tu pool es Ana, Bruno y Carla, el cursor está en Ana y todos están libres toda la semana. Las reservas van Ana, Bruno, Carla, Ana, Bruno… Rotación de manual.

Ahora el mundo real. Un invitado elige el martes a las 10:00 y Ana tiene el dentista en su Google Calendar. Cal arranca en Ana, ve que está ocupada, pasa a Bruno, está libre, Bruno se la queda. El cursor avanza un paso, a Bruno. En la próxima reserva, si Bruno está libre, también se la lleva.

Leelo de nuevo, porque es la parte honesta: **el cursor avanza una posición por reserva, no hasta quien fue elegido.** Es una rotación estricta del punto de partida, no un balanceador de equidad. No hay pesos, ni "el que hace más que no recibe", ni "el que tiene menos reuniones esta semana". Con muchas reservas y hosts mayormente disponibles, se empareja. Si una persona está siempre ocupada, los que vienen después en la lista absorben más reuniones.

Si necesitás distribución ponderada o hosts con prioridad, Cal hoy no lo hace. Calendly y otros ofrecen más perillas acá.

## Conflictos y carreras

Dos invitados hacen click en el mismo slot de las 10:00 en el mismo segundo. ¿Qué pasa?

Antes de guardar, Cal vuelve a verificar que el horario pedido siga siendo un slot ofrecido. Además, la tabla de reservas tiene un índice único sobre `(host_user_id, starts_at)` para reservas confirmadas. Si dos requests compiten por darle al mismo host el mismo horario, la base rechaza la segunda y ese invitado recibe `slot_unavailable` (HTTP 409) y elige otro horario. Ningún host queda con doble reserva.

El comentario del código admite una simplificación: elegir host y avanzar el cursor no es atómico, así que dos reservas simultáneas para horarios *distintos* pueden arrancar desde la misma posición y caer en el mismo host. Nadie queda doble-reservado; la rotación nomás se saltea un paso.

## Reprogramaciones, emails y calendarios

Cuando un invitado reprograma desde su link de gestión, Cal repite la elección para el nuevo horario, arrancando desde el cursor actual. La reunión puede pasar a otro host si el original está ocupado en el nuevo horario. Reprogramar no avanza el cursor.

Si cambia el host, Cal borra el evento del Google Calendar del host anterior y lo crea en el del nuevo. Si no, simplemente mueve el evento existente.

Todo lo que viene después sigue al host **asignado**, no al dueño del event type:

- el email de aviso va al host asignado,
- el evento de Google Calendar (con link de Meet si el event type no tiene otra ubicación) se crea en el calendario del host asignado,
- el payload del webhook `booking.created` incluye `hostUserId`.

## Detalles que conviene saber

**La disponibilidad es por event type, no por host.** Las horas semanales que configurás en el event type (en la zona horaria del dueño) aplican a todo el pool. Cal no lee el horario laboral personal de cada host. Si Bruno trabaja solo a la mañana, tiene que bloquear sus tardes —con blocked slots o en su Google Calendar— o le van a caer reuniones a la tarde.

**Conectá todos los calendarios.** Un host sin Google Calendar conectado parece libre para Cal siempre que no tenga una reserva de Cal o un blocked slot. Es la forma más común en que el round-robin sale mal: no es el algoritmo, son los datos que faltan.

**Cambiar el pool resetea un cursor fuera de rango.** Si sacás hosts y el cursor queda apuntando más allá del final de la lista nueva, vuelve a cero. Nada grave, pero no esperes continuidad perfecta después de editar el pool.

**No hay modo colectivo.** El round-robin asigna *un* host por reunión. Las reuniones que necesitan a varias personas del equipo a la vez todavía no están soportadas.

## Combinalo con ruteo

El round-robin responde "quién toma esta reunión". No responde "qué reunión debería reservar este lead". Si los leads enterprise tienen que ir a un pool y las cuentas chicas a otro, poné un routing form delante de los dos event types. Lo contamos en [formularios de ruteo en Cal](/blog/formularios-de-ruteo-en-cal).

Y si querés conectar las reservas con tus propios sistemas, `GET /api/v1/calendar/bookings` las devuelve con el host asignado, y los webhooks `booking.*` se disparan en cada cambio. Los detalles están en la [documentación de la API](/docs).

El round-robin no es magia. Es un loop sobre una lista con un puntero. La diferencia es que acá podés leer el loop.
