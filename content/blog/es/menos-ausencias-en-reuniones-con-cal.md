---
title: "Menos invitados que faltan: recordatorios y reglas en Cal"
description: "Por qué la gente falta a reuniones que ella misma reservó, y cómo bajarlo con Cal: confirmación con .ics, link para reprogramar, una secuencia de recordatorios con plantillas, reglas de reserva y la marca de No asistió."
date: "2026-10-18"
author: "zerosoft"
tags: ["cal", "reuniones", "recordatorios"]
---

Alguien elige un horario en tu página de reservas, completa el formulario, recibe la confirmación. Llega la hora y no aparece. No hay mala fe en la mayoría de los casos. Hay cuatro causas que se repiten:

1. **Se olvidó.** Reservó hace dos semanas y la reunión nunca llegó a su calendario.
2. **Le surgió algo y no sabía cómo avisar.** Cancelar le parecía más incómodo que faltar.
3. **Reservó sin mucho compromiso.** Dos clics, cero esfuerzo, cero costo de no ir.
4. **Reservó a destiempo.** Demasiado lejos para acordarse, o tan cerca que no llegó a organizarse.

Cada causa tiene un remedio distinto. Este post las recorre en orden, con lo que hace Cal en cada caso, plantillas para copiar y lo que todavía no hacemos.

## 1. Que la reunión llegue a su calendario

Un email de confirmación que queda en la bandeja de entrada se olvida. Un evento en el calendario suena solo.

Cal manda la confirmación en el idioma en que la persona reservó, con un archivo `.ics` adjunto: un toque y queda en Google Calendar, Outlook o el calendario del teléfono. Si conectaste Google Calendar en la configuración, además se crea el evento en tu calendario con la persona como invitada (y el link de Meet, si la ubicación es Google Meet), así que también le llega por el lado de Google.

Cuando la reunión se reprograma, el `.ics` actualiza el mismo evento en lugar de crear uno nuevo. Nadie termina con dos eventos para la misma llamada.

## 2. Que cancelar sea más fácil que faltar

Una cancelación con tiempo es una buena noticia: el horario vuelve a estar libre para otra persona. Una ausencia es una hora perdida para los dos.

Cada confirmación trae un link de **Reprogramar o cancelar**. Abre una página donde la persona elige otro horario o cancela, sin cuenta ni contraseña. Del lado tuyo, en **Reservas**, también podés reprogramar vos: elegís el horario nuevo y Cal le manda a la persona la invitación actualizada.

Ese link es la pieza más subestimada. Ponelo también en cada recordatorio con la variable `{{manage}}`, que mostramos abajo.

## 3. Una secuencia de recordatorios

Sin configurar nada, cada tipo de evento manda un recordatorio al invitado 24 horas antes. Para muchas reuniones alcanza. Para las que importan, armá una secuencia en el tipo de evento, sección **Recordatorios**:

- Hasta 10 pasos por tipo de evento.
- Cada paso va al **invitado** o al **anfitrión**, una cantidad de minutos, horas o días **antes** o **después** del inicio (hasta 30 días).
- Asunto y mensaje propios, con variables: `{{guest.name}}`, `{{guest.email}}`, `{{host.name}}`, `{{event.title}}`, `{{start}}`, `{{link}}` y `{{manage}}`.
- `{{start}}` sale con la zona horaria de quien lo recibe. `{{link}}` es el link de la videollamada o la ubicación.

Si agregás pasos, reemplazan al recordatorio de 24 horas. Un dato práctico: los recordatorios salen de un proceso que corre cada hora, así que pueden llegar hasta una hora tarde. Un "15 minutos antes" no tiene sentido; usá 2 o 3 horas.

### Plantillas para copiar

Una secuencia de tres pasos que funciona para demos, consultas y entrevistas:

**Paso 1: invitado, 2 días antes**

> Asunto: {{event.title}} el {{start}}
>
> Hola {{guest.name}}, te escribo para confirmar que nos vemos el {{start}}.
>
> Si querés que preparemos algo en particular, respondé este email.
>
> ¿Cambió tu agenda? Elegí otro horario acá: {{manage}}

**Paso 2: invitado, 3 horas antes**

> Asunto: Hoy: {{event.title}}
>
> Hola {{guest.name}}, nos vemos hoy a las {{start}}.
>
> Link para entrar: {{link}}
>
> Si no llegás, avisame acá y lo movemos: {{manage}}

**Paso 3: anfitrión, 1 día antes**

> Asunto: Mañana: {{event.title}} con {{guest.name}}
>
> {{guest.name}} ({{guest.email}}) tiene reunión el {{start}}. Revisá sus respuestas en Reservas antes de la llamada.

El tercero parece menor y no lo es: buena parte de las reuniones fallidas son del anfitrión que llega tarde o sin preparar.

## 4. Reglas que filtran reservas flojas

Algunas ausencias se evitan antes de que exista la reserva. Las reglas viven en cada tipo de evento (y tienen valores por defecto en **Configuración**):

- **Antelación mínima.** Si alguien reserva para dentro de 20 minutos, probablemente no llegue a organizarse. 2 a 4 horas es un buen piso para llamadas de venta. Más detalle en el post sobre [buffers, aviso mínimo y ventana](/blog/buffers-aviso-minimo-y-ventana).
- **Reservable hasta.** Una reserva a 60 días es casi una promesa vaga. Para una demo, 14 a 21 días suele alcanzar.
- **Preguntas propias.** Nombre y email se piden siempre. Una pregunta como "¿Qué querés ver en la llamada?" hace que reservar cueste un minuto, y quien escribe una respuesta suele presentarse.
- **Link de un solo uso.** Para mandarle a una persona concreta: el link deja de funcionar después de la primera reserva, así no termina reenviado a un grupo.
- **Cobro al reservar.** Si das sesiones pagas, conectá tu cuenta de Stripe en **Configuración › Pagos** y ponele precio al tipo de evento. La reserva queda como **Esperando pago** y se confirma cuando la persona paga en Stripe Checkout; si no paga en 35 minutos, el horario se libera. Pagar por adelantado es el filtro de compromiso más fuerte que existe.

## 5. Medir: la marca de No asistió

Lo que no se anota no se mejora. En **Reservas**, cada reunión que ya empezó tiene la opción **No asistió**. Cal no la deja marcar antes del inicio, porque marcarla libera el horario.

La marca tiene un efecto útil sobre la secuencia: los pasos "después" solo salen para reservas confirmadas. Si tenés un paso "invitado, 1 hora después" con un "gracias por la charla, acá va el resumen", marcar No asistió evita que le llegue a quien no vino.

Para sacar tu tasa de ausencias del mes, usá la API con una clave con permiso `cal:read`:

```bash
curl -s "https://zerosoft.ai/api/v1/calendar/bookings?status=no_show&from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z" \
  -H "Authorization: Bearer $ZEROSOFT_KEY" | jq '.bookings | length'
```

Cambiá `status=no_show` por `status=confirmed` y tenés el denominador. Con eso alcanza para ver si el cambio de la semana pasada sirvió.

## Lo que Cal todavía no hace

Para que compares con lo que usás hoy:

- **SMS o WhatsApp.** Los recordatorios son solo por email.
- **Enviar desde tu Gmail.** En zerosoft Cloud los emails salen de una dirección de zerosoft, con el color y el logo del tipo de evento. En el self-host elegís el remitente con `EMAIL_FROM`.
- **Un email automático a quien faltó para que vuelva a reservar.** Hoy la marca de No asistió frena los pasos posteriores, pero no dispara uno propio. Mientras tanto, mandale tu link de reservas a mano desde el detalle.

Del otro lado, en Calendly los recordatorios configurables viven en Workflows, que según [su propia guía](https://calendly.com/blog/guide-calendly-reminders) están disponibles en los planes pagos. En Cal la secuencia no depende del plan: está en zerosoft Cloud (donde los emails se cobran por uso) y en el self-host.

## Resumen

- Confirmación con `.ics` y evento en Google Calendar: la reunión entra al calendario.
- Link de reprogramar o cancelar en cada email, también en los recordatorios con `{{manage}}`.
- Tres pasos: invitado 2 días antes, invitado 3 horas antes, anfitrión 1 día antes.
- Antelación mínima, ventana corta, una pregunta propia y, si cobrás, pago al reservar.
- Marcá No asistió y mirá el número una vez por mes.
