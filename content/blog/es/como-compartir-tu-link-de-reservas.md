---
title: "Cómo compartir tu link de reservas para que la gente lo use"
description: "Dónde poner el link de Cal (email, firma, web, campañas), cómo prellenar datos, medir de dónde viene cada reserva y cuándo conviene un link secreto o de un solo uso."
date: "2026-11-06"
author: "zerosoft"
tags: ["cal", "agendar", "guía"]
---

Armar el tipo de evento lleva diez minutos. Lograr que la gente lo use lleva más, porque un link de reservas mal puesto convive con el viejo "¿te sirve el martes?" por email. Esta guía junta los lugares donde conviene ponerlo, qué decir al lado y qué ajustes de Cal ayudan en cada caso.

## 1. Elegí el link correcto

Cal te da tres formas de link, todas con el mismo formato:

- `https://zerosoft.ai/es/book/tu-handle` es tu perfil público y lista todos tus tipos de evento activos.
- `https://zerosoft.ai/es/book/tu-handle/demo-30` abre un tipo de evento concreto.
- Un tipo de evento **secreto** se reserva con el link, pero no aparece en tu perfil. Se activa en el editor del tipo de evento.

La regla práctica: al público general, el link al evento concreto. El perfil con la lista sirve en una bio de redes, donde la persona todavía no sabe qué quiere. Si tu perfil tiene seis tipos de evento, quien llega ahí tiene que decidir antes de reservar, y decidir frena.

Los tipos secretos, los de un solo uso y las encuestas de horarios llevan `noindex`, así que no aparecen en buscadores.

## 2. En un email: una frase y el link

Un link suelto como único contenido del mensaje se lee como automático. Funciona mejor una frase con contexto y una salida:

> Hola Ana, para ver el tablero con tu equipo alcanzan 30 minutos. Elegí el horario que te quede cómodo acá: https://zerosoft.ai/es/book/lau/demo-30
>
> Si ninguno te sirve, contestame con dos horarios y lo resolvemos por acá.

El segundo párrafo importa. Hay gente que no quiere usar el link en el primer contacto, y darle otra puerta evita que el mensaje quede sin respuesta. Los clientes de correo no ejecutan widgets, así que en un email siempre va el link en texto o en un botón, no un embed. [Calendly lo explica igual en su ayuda](https://help.calendly.com/hc/en-us/articles/31618986451863-How-to-add-Calendly-to-an-email-or-email-template): el scheduler no se incrusta en el correo, se enlaza.

## 3. Prellená nombre, email y respuestas

Si ya sabés quién es la persona (viene de un CRM, de una lista, de un formulario), no la hagas escribir de nuevo. La página de reservas lee parámetros de la URL:

```
https://zerosoft.ai/es/book/lau/demo-30?name=Ana%20Paz&email=ana%40acme.com
```

Esos dos campos llegan completos al formulario. Lo mismo pasa con las preguntas propias: si tu tipo de evento tiene una pregunta con el nombre interno `empresa`, el parámetro `empresa=Acme` la prellena. Para listas desplegables y opciones solo se toma el valor si coincide con una de las opciones que definiste.

Dos límites para tener presentes: los valores se recortan (200 caracteres para nombre y email, 2000 para respuestas) y el nombre y el email del invitado siguen siendo editables, así que el prellenado ahorra tipeo, no valida identidad.

Si tu CRM es el de zerosoft, el botón **Book meeting** de un contacto o un deal genera este tipo de link y, al reservar, la reunión queda registrada en la ficha. Más en [workflows del CRM](/blog/workflows-crm-tareas-de-seguimiento).

## 4. Marcá de dónde viene cada reserva

Si ponés el mismo link en la firma, en el newsletter y en un anuncio, no vas a saber cuál trae reservas. Cal guarda los cinco parámetros `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` y `utm_content` que lleve el link, y los adjunta a la reserva. Después llegan al anfitrión y a los webhooks.

Una convención simple, una por canal:

| Dónde | Link |
|---|---|
| Firma de email | `.../demo-30?utm_source=firma&utm_medium=email` |
| Newsletter de octubre | `.../demo-30?utm_source=newsletter&utm_medium=email&utm_campaign=octubre` |
| Bio de LinkedIn | `.../demo-30?utm_source=linkedin&utm_medium=bio` |
| Botón en la web de precios | `.../demo-30?utm_source=web&utm_content=precios` |

Cal solo guarda esas cinco claves, como texto de una línea y hasta 200 caracteres. Cualquier otro parámetro que no sea un campo del formulario se ignora, así que no sirve para pasar datos arbitrarios. Si la web es tuya, el [embed de Cal](/blog/embeber-cal-en-tu-sitio) evita que el visitante salga de la página.

## 5. Cuándo usar un link de un solo uso

Para una persona concreta, un link secreto con un horario acotado es más prolijo que el perfil público. Hay dos opciones útiles:

- **Link de un solo uso.** Deja de funcionar después de la primera reserva. Si lo reenvían a otra persona, la página muestra que expiró. Si en cambio querés repartir las reuniones entre un equipo, mirá [round-robin con Cal](/blog/round-robin-con-cal).
- **Reunión única.** Elegís los horarios exactos que ofrecés, incluso fuera de tu agenda semanal, y compartís ese link. Sirve para una revisión puntual con un cliente que necesita un día raro.

## 6. Una checklist antes de mandarlo

Abrí el link en una ventana privada y recorré el flujo como invitado:

1. Los horarios aparecen en tu zona y en la de quien reserva (probá con otra zona horaria; hay más en [zonas horarias en agendas](/blog/zonas-horarias-en-agendas)).
2. El formulario pide lo mínimo que necesitás.
3. Llega el email de confirmación con `.ics` y el link para reprogramar.
4. En el celular, la página se ve completa sin scroll horizontal.
5. Reservaste de prueba y cancelaste, así el horario queda libre.

## Lo que todavía falta

Para que compares con lo que usás hoy: no hay generación automática de QR para el link de reservas dentro de Cal, y los recordatorios salen solo por email. Para un QR, usá el [generador de QR](/es/tools/qr-code-generator) de las herramientas del sitio y apuntalo a tu URL de reservas.

## Resumen

- Link concreto a un evento para el público, perfil para las bios.
- En un email: una frase, el link y una segunda salida.
- `?name=` y `?email=` prellenan, y también las preguntas por su nombre interno.
- Cinco claves `utm_*` viajan con la reserva: usá una convención por canal.
- Secreto, un solo uso o reunión única cuando es para una persona.
