---
title: "Qué datos deja una reserva y a dónde viajan"
description: "El mapa completo de una reserva en Cal: qué se guarda en la fila, qué copias salen al email, a Google Calendar, al CRM, a webhooks y a Stripe, y cómo responder un pedido de borrado. Con lo que falta, dicho."
date: "2026-10-18"
author: "zerosoft"
tags: ["cal", "privacidad", "datos", "self-host"]
---

Las guías de privacidad para herramientas de agenda suelen arrancar por los papeles: contrato de encargado, lista de subencargados, cláusulas de transferencia. Son necesarios, y Cal.com publicó una [guía larga sobre GDPR](https://cal.com/blog/gdpr-compliant-scheduling) que los cubre bien. Pero antes de los papeles hay una pregunta más concreta, la que te va a hacer cualquier persona que pida ver o borrar sus datos: **¿dónde están?**

Este post responde eso para Cal, leído del código. Es el mapa que necesitás para escribir tu aviso de privacidad, contestar un pedido de borrado o decidir si te conviene el self-host.

## La fila: qué guarda Cal de cada reserva

Cada reserva es una fila en la tabla `calendar_bookings`. Estos son sus datos personales y operativos:

| Campo | Qué es |
|---|---|
| `invitee_name`, `invitee_email` | Nombre y email de quien reservó. Siempre obligatorios |
| `starts_at`, `ends_at`, `timezone` | Horario y zona horaria de la persona |
| `locale` | Idioma en que reservó (para mandarle los emails en ese idioma) |
| `answers` | Las respuestas a tus preguntas propias, en JSON |
| `status`, `cancel_reason` | Confirmada, cancelada, no asistió o esperando pago, y el motivo si canceló |
| `host_user_id` | Quién de tu equipo la atiende (en round-robin) |
| `meeting_url`, `google_event_id` | Link de la videollamada y referencia al evento de Google |
| `manage_token` | El token del link para reprogramar o cancelar |
| `payment_status`, `amount_cents`, `currency`, `stripe_session_id` | Solo si el tipo de evento cobra |

Lo que **no** está en la fila: la dirección IP, el navegador, el dispositivo. El endpoint de reservas usa la IP para frenar abusos (hasta 10 intentos cada 10 minutos por IP) en una tabla de límites que se borra sola cuando termina la ventana. Nuestra [política de privacidad](/privacy) lo detalla, junto con los logs de corta duración del proveedor de hosting.

La columna que más cuidado pide es `answers`. Una pregunta de texto libre como "¿Algo que debamos saber?" invita a respuestas que no querés guardar: un diagnóstico médico, un problema legal, datos de un tercero.

## Las copias: a dónde viaja cada reserva

Cuando alguien confirma, Cal hace cinco cosas además de guardar la fila. Cada una deja una copia en otro lugar:

1. **Emails.** La confirmación al invitado (con `.ics`), el aviso al anfitrión y cada recordatorio. En zerosoft Cloud salen por Resend. Llevan nombre, horario, ubicación y el link de gestión.
2. **Google Calendar**, si lo conectaste. Se crea un evento en tu calendario con el título del tipo de evento, el nombre de la persona, su email como invitado y una descripción con nombre y email. Las respuestas no viajan a Google.
3. **CRM.** Cada reserva crea el contacto si no existe (nombre y email) y una actividad de reunión en su ficha. El cuerpo de esa actividad incluye las respuestas. Si después cancela, la actividad suma el motivo.
4. **Webhooks y Flow.** Los eventos `booking.created`, `booking.rescheduled` y `booking.cancelled` mandan a tus URLs el nombre, el email, el horario, las respuestas y, si hay, el pago. Lo que haga el receptor con eso ya es tuyo.
5. **Stripe**, si cobrás. La sesión de Checkout queda en tu cuenta de Stripe, con lo que Stripe pida para cobrar.

Este mapa es el que vas a necesitar el día que alguien te escriba. Guardalo al lado de tu aviso de privacidad.

## Quién es responsable de qué

Para las reservas que recibís, el responsable de los datos sos vos: decidís qué preguntar, para qué y por cuánto tiempo. En zerosoft Cloud, zerosoft procesa esos datos por cuenta tuya, y los proveedores que operan la nube (Vercel para el hosting, Turso para la base de datos, Resend para los emails) figuran en la [política de privacidad](/privacy). Google, Stripe y los receptores de tus webhooks entran solo si los conectás vos.

Con el self-host la cadena se acorta: el servidor, la base y el proveedor de email los elegís vos, y el código AGPLv3 está para que cualquiera de tu equipo verifique este mapa. Para un equipo que necesita que los datos no salgan de un país, es el camino más directo. Como referencia, Cal.com cuenta en esa misma guía que su hosting en la Unión Europea es para empresas de 50 usuarios o más y que estaba en acceso anticipado.

## Juntar menos desde el formulario

Lo más barato de proteger es lo que no se guarda. En las **Preguntas** de cada tipo de evento:

- **Preferí sí/no o número antes que texto libre.** Las preguntas propias pueden ser de texto, número o sí/no. "¿Ya usás un CRM?" responde lo mismo que "Contanos tu situación" y deja menos texto suelto.
- **Marcá como opcional lo que no necesitás sí o sí.** Cada pregunta tiene su casilla de obligatoria.
- **Escribí qué no mandar.** En el mensaje de bienvenida del tipo de evento, una línea como "No incluyas datos de salud ni de terceros en este formulario" ahorra problemas.
- **Revisá las preguntas cada trimestre.** La pregunta que agregaste para una campaña sigue ahí juntando datos.

## Cómo contestar un pedido de borrado

Alguien te escribe: "Borren todo lo que tengan de mí". Con el mapa de arriba, el recorrido es este:

1. **Cal.** Cancelar una reserva no la borra: queda como cancelada, con su historial. Hoy Cal no tiene un botón para borrar una reserva puntual; borrar un tipo de evento borra todas sus reservas, que rara vez es lo que querés. En zerosoft Cloud, el canal para un pedido puntual es privacy@zerosoft.ai, que figura en la política de privacidad. En el self-host lo hacés vos en la base (abajo va el SQL).
2. **CRM.** Borrá el contacto desde su ficha. Revisá que no haya quedado en una lista o un deal.
3. **Google Calendar.** Borrá el evento a mano. Si la persona era invitada, su copia en su propio calendario es suya.
4. **Webhooks.** Lo que llegó a tu planilla, tu base o tu automatización hay que borrarlo ahí.
5. **Stripe.** Los pagos tienen sus propias reglas de conservación por motivos fiscales; revisá las de Stripe y las de tu país antes de borrar.
6. **Contestá con fecha.** Decile a la persona qué borraste y dónde.

Para el self-host, este SQL borra las reservas de un email y sus recordatorios pendientes. Hacé un backup antes:

```sql
DELETE FROM calendar_workflow_runs
  WHERE booking_id IN (SELECT id FROM calendar_bookings WHERE invitee_email = 'persona@ejemplo.com');
DELETE FROM calendar_reminders
  WHERE booking_id IN (SELECT id FROM calendar_bookings WHERE invitee_email = 'persona@ejemplo.com');
DELETE FROM calendar_bookings WHERE invitee_email = 'persona@ejemplo.com';
```

## Lo que falta, dicho

- **Borrar una reserva desde la interfaz.** Es el hueco más grande de este post.
- **Retención automática.** No hay una regla del tipo "borrar reservas de más de 24 meses". Las reservas se guardan mientras vos las conserves.
- **Exportar las reservas de una persona.** La API lista reservas con búsqueda (`GET /api/v1/calendar/bookings?q=`), que sirve para armar un pedido de acceso, pero no hay un botón de "exportar todo lo de este email".

Si alguna te frena, contalo en el [feedback board](/feedback). Mientras tanto, el mapa de copias es lo que más tiempo te va a ahorrar: un pedido de borrado sin mapa lleva una tarde, y con mapa lleva quince minutos.
