---
title: "Cal en tu sitio: inline, popup, Google Meet y recordatorios"
description: "Cómo poner tu página de reservas de Cal en tu web, conectar Google Calendar para que cada reunión tenga link de Meet y verificar que salgan los links de cancelación y el recordatorio de 24 horas."
date: "2026-09-15"
author: "zerosoft"
tags: ["cal", "agendar", "tutorial"]
---

Un link de reservas en la firma del mail sirve. Una página de reservas en tu propio sitio, donde el visitante ya está, le ahorra un paso. Esta guía cubre el setup completo: embeber Cal inline o como popup, conectar Google Calendar para que cada reunión tenga link de Meet, y las dos cosas que todos se olvidan: el link del invitado para cancelar o reprogramar y el recordatorio de 24 horas.

## 1. Embebé la página de reservas

Abrí cualquier event type en **Cal → Event types**. Abajo de todo hay un panel **Embed on your site** con dos pestañas. Copiá el snippet que quieras y pegalo en tu sitio. Un solo tag de script, sin paquete de npm, sin framework.

### Inline

```html
<script src="https://zerosoft.ai/api/calendar/embed.js"
        data-url="https://zerosoft.ai/es/book/ana/intro"
        async></script>
```

El calendario aparece justo donde pusiste el script, como un iframe. La altura se ajusta sola: la página de reservas le avisa su alto a tu página a medida que el visitante avanza, así no hay una barra de scroll interna peleándose con tu layout. Ponelo en una página de "Pedí una demo" o "Contacto".

### Popup

```html
<script src="https://zerosoft.ai/api/calendar/embed.js"
        data-url="https://zerosoft.ai/es/book/ana/intro"
        data-mode="popup"
        data-label="Reservar una reunión"
        data-color="#0d0d0d"
        async></script>
```

Esto agrega un botón flotante abajo a la derecha. Al hacer click, abre la página de reservas en un modal. Escape o un click afuera lo cierran. `data-label` es el texto del botón y `data-color` su fondo. Ideal para tenerlo en todo el sitio: precios, docs, blog.

### Reaccionar a una reserva

Cuando se confirma una reserva dentro del iframe, el script dispara un evento `zs-cal:booked` que sube desde el tag del script. Usalo para disparar tu propio analytics o mostrar un mensaje de agradecimiento:

```html
<script>
  document.addEventListener('zs-cal:booked', function (e) {
    // e.detail.start es el horario reservado (ISO), e.detail.eventTypeId el event type
    console.log('Booked!', e.detail.start);
  });
</script>
```

El script solo escucha mensajes que vienen del origen de la página de reservas y de su propio iframe, así que otros frames de tu página no pueden simular una reserva.

### Detalles que conviene saber

- **Elegí el idioma en la URL.** `/en/book/…`, `/es/book/…` o `/pt/book/…`. La página, y los mails que recibe el invitado, lo siguen.
- **La zona horaria del invitado se detecta sola** desde su navegador, y la puede cambiar desde un desplegable. Tu página no tiene que hacer nada. (Los detalles nerds están en [cómo maneja Cal las zonas horarias](/blog/zonas-horarias-en-agendas).)
- **Tu marca viaja con el embed.** El color de marca, el logo y el mensaje de bienvenida del event type aparecen también adentro.
- **¿Self-hosting?** Reemplazá `zerosoft.ai` por tu dominio en las dos URLs. El script se sirve con CORS abierto y se cachea una hora.

## 2. Conectá Google Calendar

Sin un calendario conectado, Cal solo conoce las reuniones reservadas por Cal y los blocked slots que cargues a mano. Conectá Google y cambian dos cosas.

Andá a **Cal → Settings** y hacé click en **Connect Google Calendar**. Google pide dos permisos (free/busy y eventos) y Cal necesita los dos. Si destildás uno, te pide que lo intentes de nuevo.

**Tus horarios ocupados bloquean slots.** Antes de mostrar disponibilidad, Cal le pide a Google el free/busy de tu calendario **principal**. El turno con el dentista que cargaste desde el celular esconde esos slots de tu página. La respuesta se cachea alrededor de un minuto, así que los cambios se ven rápido.

**Las reservas caen en tu calendario.** Cada reserva nueva crea un evento en tu Google Calendar principal, con el invitado como asistente. Si la ubicación del event type está vacía o dice "Google Meet", el evento se crea con un **link de Google Meet**, que Cal guarda y pone en los mails de confirmación, en la invitación `.ics` y en tu lista de reservas ("Join meeting"). Reprogramar mueve el evento; cancelar lo borra.

Cal crea el evento de Google con las notificaciones apagadas, porque el invitado ya recibe el mail de Cal con la invitación adjunta. Nada de invitaciones duplicadas. Y si tenés Google conectado, tu aviso como host no trae el `.ics`, así no terminás con la reunión dos veces.

Todo es best-effort a propósito: si Google está caído o tu token venció, la reserva sale igual. Una caída del calendario no debería costarte una reunión.

Cada persona conecta su propio calendario. En un equipo con [round-robin](/blog/round-robin-con-cal), todos los hosts tienen que hacerlo, o Cal va a creer que están libres cuando no lo están.

**Self-hosting:** configurá `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, y agregá `<NEXTAUTH_URL>/api/integrations/google-calendar/callback` como redirect URI autorizada en tu consola de Google Cloud. Si falta, la página de settings de Cal te dice la URI exacta.

Lo que **no** está: Outlook, iCloud y otros calendarios CalDAV todavía no están soportados, y para conflictos solo se mira el calendario principal de Google, no los secundarios.

## 3. Links para cancelar y reprogramar

Cada mail de confirmación que recibe el invitado trae un link **Reprogramar o cancelar**. Apunta a `/book/manage/<token>`, una página privada atada a un token largo y aleatorio. Sin cuenta, sin contraseña: el link *es* la credencial.

Desde ahí el invitado puede:

- **Reprogramar** a cualquier otro slot que estés ofreciendo. Mismas reglas que una reserva nueva: buffers, aviso mínimo, disponibilidad.
- **Cancelar**, con un motivo opcional que te llega a vos.

Las dos acciones mandan mails al invitado y al host (con un `.ics` actualizado o de cancelación), actualizan Google Calendar y disparan el webhook `booking.rescheduled` o `booking.cancelled`. Una vez que la reunión empezó, el link deja de aceptar cambios.

De tu lado, podés cancelar desde la lista de reservas de Cal, o por API con `POST /api/v1/calendar/bookings/:id/cancel`.

## 4. Recordatorios que salen de verdad

Cal le manda al invitado un recordatorio **24 horas antes** de la reunión, en su idioma, con el link para reprogramar o cancelar. Para que eso pase tienen que estar dos piezas.

**El envío de mails.** Cal manda mails a través de Resend. Configurá `RESEND_API_KEY` y `EMAIL_FROM` (una dirección de un dominio verificado en Resend). Sin la key, los mails se imprimen en la consola del servidor en vez de enviarse: práctico en desarrollo, una falla silenciosa en producción.

**El cron.** Los recordatorios se encolan en la base y los manda un job periódico en `/api/cron/tick`, que también se ocupa de los reintentos de webhooks. En Vercel, el `vercel.json` incluido lo corre cada hora. En otro lado, programalo vos:

```bash
# crontab: every hour at :17
17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://cal.example.com/api/cron/tick
```

En producción el endpoint se niega a correr sin `CRON_SECRET`, y lo exige como Bearer token. Como el job corre cada hora, el recordatorio sale entre 24 y 23 horas antes de la reunión. Si el envío falla, no se marca como enviado, así que el próximo run lo reintenta. Las reservas canceladas descartan su recordatorio pendiente; las reprogramadas reciben uno nuevo. Las reuniones reservadas con menos de 24 horas de anticipación no tienen recordatorio, porque la confirmación acaba de llegar.

Si querés otros tiempos (por ejemplo, tres horas antes), sumá pasos de workflow en el tipo de evento: reemplazan a este recordatorio y salen con el mismo cron. Todavía no hay recordatorios por SMS.

## Checklist de cinco minutos

- Event type creado, con disponibilidad y buffers ([acá contamos cómo pensarlos](/blog/buffers-aviso-minimo-y-ventana)).
- Snippet pegado, inline o popup.
- Google Calendar conectado, ubicación vacía o "Google Meet".
- `RESEND_API_KEY`, `EMAIL_FROM` y `CRON_SECRET` configurados, cron corriendo.
- Reservá una reunión de prueba desde una ventana privada, y después reprogramala y cancelala desde el mail.

Si la reserva de prueba aparece en tu calendario con link de Meet y llega el mail de cancelación, listo.
