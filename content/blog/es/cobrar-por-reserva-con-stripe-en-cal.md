---
title: "Cobrar por una reserva con Stripe en Cal: guía paso a paso"
description: "Cómo cobrar consultas y sesiones desde tu página de reservas con tu propia cuenta de Stripe: configuración, qué pasa si el invitado no paga y cómo se reembolsa."
date: "2026-10-26"
author: "zerosoft"
tags: ["cal", "agendar", "pagos"]
---

Si das consultorías, clases o sesiones de asesoría, tarde o temprano te toca la misma escena: alguien reserva una hora de tu tiempo, no aparece y no pasa nada. La solución habitual es cobrar al momento de reservar. El tiempo reservado y pagado casi nunca se cancela el mismo día.

Calendly tiene su [guía para cobrar al reservar](https://calendly.com/blog/pay-at-booking) y su [página de pagos](https://calendly.com/learn/calendly-payments): se conecta Stripe o PayPal, se activa el cobro en cada tipo de evento y el dinero va a tu cuenta. Según su centro de ayuda, el cobro no está en todos los planes, así que conviene revisar el tuyo antes de armar nada.

Acá va la versión de Cal: cómo se configura, qué pasa en cada caso raro y qué todavía no hace. Todo lo que sigue sale del código, que es abierto.

## Cómo funciona el cobro en Cal

Cal no cobra por vos ni se queda en el medio. Usás tu propia cuenta de Stripe y le das a Cal una clave secreta. Cal la guarda cifrada y la usa para crear una sesión de Stripe Checkout por cada reserva. El dinero va de Stripe a tu cuenta. Las comisiones que te cobre Stripe son las de tu contrato con Stripe.

La secuencia, desde el lado del invitado:

1. Elige un horario en tu página de reservas y completa el formulario.
2. Cal guarda la reserva como pendiente y **retiene el horario 35 minutos**. En ese lapso nadie más puede tomarlo.
3. El invitado paga en Stripe Checkout.
4. Stripe avisa a Cal por webhook y la reserva pasa a confirmada. Recién ahí salen el email de confirmación y el evento de calendario.

Si el invitado vuelve sin pagar o la sesión vence, el horario se libera solo.

## Paso 1: conectar Stripe

Andá a **Cal → Configuración → Pagos con Stripe**. Hay tres datos:

- **Clave secreta** (empieza con `sk_` o `rk_`). Una clave restringida (`rk_`) sirve y es lo más prolijo: dale permiso solo para Checkout Sessions y Refunds. Cal te muestra solo los últimos cuatro caracteres y si es modo test o live.
- **URL del webhook.** Cal te da una única por workspace. Copiala.
- **Signing secret del webhook** (`whsec_`). Lo generás en Stripe, en Developers → Webhooks, pegando esa URL.

En el webhook de Stripe marcá estos cuatro eventos: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` y `checkout.session.async_payment_failed`.

Cal exige las dos piezas, clave y signing secret, para aceptar reservas pagas. Si falta el secret, los invitados no pueden reservar ese evento y el editor te lo avisa. Es a propósito: sin webhook, un pago que el invitado completa y no vuelve a tu página podría quedar cobrado con la reserva vencida.

Solo el owner o un admin del workspace puede cambiar esta configuración.

## Paso 2: poner precio a un tipo de evento

En el editor del tipo de evento, pestaña **Pagos**, elegís precio y moneda. Las monedas disponibles son USD, EUR, ARS, BRL, MXN, CLP, COP y GBP. Con precio 0, el evento es sin cobro.

Algunas reglas que Cal valida al guardar:

- El monto acepta `15000`, `15.000` o `15.000,50`. Un solo separador seguido de tres dígitos se lee como miles.
- CLP no tiene centavos: se escribe un entero.
- Hay un mínimo por cargo que impone Stripe. Cal lo conoce para USD, EUR, GBP, BRL y MXN y rechaza un precio menor antes de que el Checkout falle en producción.

Probalo primero con una clave de modo test y la tarjeta de prueba de Stripe. Hacé una reserva completa, mirá que llegue la confirmación y cancelala para ver el reembolso.

## Qué pasa en los casos raros

Un sistema de cobro se prueba con lo que sale mal, no con el camino feliz. Esto hace Cal:

- **El invitado no paga.** A los 35 minutos el hold vence, el horario vuelve a estar libre y la reserva pendiente se descarta.
- **Paga con el hold ya vencido.** Si el horario sigue libre, la reserva se confirma igual. Si alguien más lo tomó, se reembolsa el pago completo automáticamente.
- **Medios de pago diferidos** (efectivo, boleto). El hold se extiende hasta 72 horas, nunca más allá del inicio de la reunión. Si el pago entra con la reunión ya empezada, se reembolsa.
- **Cancelás una reserva paga.** Sea el anfitrión, el invitado o la API, Cal reembolsa el pago completo y la deja en "reembolsado". Si Stripe falla en ese momento, la reserva queda cancelada con el pago marcado como pagado, para que lo reembolses a mano desde Stripe.
- **Borrás un tipo de evento con reservas por venir.** Cal te pide cancelarlas antes, y al cancelar se avisa a los invitados y se reembolsa.
- **Eventos de otro origen.** Cal ignora los webhooks que no llevan su metadata o cuyo monto y moneda no coinciden con la reserva. Un Payment Link que tengas en la misma cuenta no puede confirmar ni cancelar reservas.

## Una política de cobro que funciona

Cal reembolsa siempre el total. Si querés una política más fina, la tenés que armar con el diseño del evento:

- **Sesión de primera consulta corta y paga.** Una llamada de 20 o 30 minutos a un precio bajo filtra curiosos sin espantar a nadie. La sesión larga la reservan después.
- **Aviso mínimo largo.** Con 24 horas de aviso mínimo, quien reserva ya sabe que no es para hoy. Mirá [buffers, aviso mínimo y ventana](/blog/buffers-aviso-minimo-y-ventana).
- **Pregunta previa.** Una pregunta obligatoria en el formulario ("¿qué querés resolver en la sesión?") te deja llegar preparado.
- **Un workflow de recordatorio.** Un email 24 horas antes con el link de la reunión y el link para reprogramar reduce los reclamos. Más en [menos ausencias en reuniones con Cal](/blog/menos-ausencias-en-reuniones-con-cal).

## Lo que todavía no hace

Cal es honesto sobre sus huecos. Hoy:

- Solo hay Stripe. **PayPal no está.**
- No hay cupones ni descuentos, ni pagos parciales o señas.
- Los reembolsos parciales se hacen desde Stripe, no desde Cal.
- No calcula impuestos: eso queda en la configuración de tu cuenta de Stripe.

Si alguno de estos puntos es indispensable para vos, Calendly o un Payment Link propio pueden resolverlo hoy.

## Cuánto cuesta

Self-host: $0, con el cobro incluido, porque el core es AGPL con todas sus funciones. En zerosoft Cloud no hay precio por usuario: se paga por reserva y almacenamiento, y la comisión de Stripe es aparte y va directo a tu cuenta de Stripe. Para el cálculo completo de por qué una reserva no debería costar por asiento, leé [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly).

## Checklist final

1. Clave restringida de Stripe en modo test cargada en Cal.
2. Webhook creado con los cuatro eventos y el signing secret pegado.
3. Precio y moneda en el tipo de evento, con el mínimo respetado.
4. Una reserva de prueba completa, confirmada y cancelada con reembolso.
5. Recién ahí, claves live y precio real.
