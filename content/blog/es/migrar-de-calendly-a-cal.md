---
title: "Migrar de Calendly a Cal: tipos de evento, horarios y reservas"
description: "Cómo pasar de Calendly a Cal con un token personal: qué se importa (tipos de evento, preguntas, disponibilidad, reservas próximas), qué no y qué revisar."
date: "2026-10-31"
author: "zerosoft"
tags: ["cal", "calendly", "migración", "guía"]
---

Cambiar de herramienta de agenda tiene una parte fácil y una incómoda. La fácil es crear la cuenta nueva. La incómoda es todo lo que ya configuraste en Calendly: tipos de evento con sus preguntas, horarios con excepciones, reservas de las próximas semanas y el link que está en tu firma de mail.

Esta guía cuenta cómo funciona el import de Calendly en [Cal](/products/cal), qué trae exactamente (lo leímos del código del importador), qué tenés que rehacer a mano y en qué orden conviene hacer el cambio para que nadie se quede sin reunión.

## Qué necesitás

- **Un token de acceso personal de Calendly.** En Calendly, abrí Integraciones y apps › API y webhooks, y en Tokens de acceso personal generá uno. El import usa la API v2 de Calendly y solo lee.
- **Ser admin del workspace** en zerosoft. Lo que importás queda disponible para todo el workspace.

El token queda cifrado mientras se leen tus datos y se borra cuando el import termina, falla o se cancela. Igual podés revocarlo en Calendly después.

## Paso a paso

1. En Cal, andá a **Configuración › Importar**. También está en el hub de importación del workspace (**Ajustes › Importar**, fuente Calendly).
2. Pegá el token en **Token de acceso personal de Calendly**.
3. Decidí si marcás **Importar también las reservas próximas**. Más abajo está lo que conviene saber antes.
4. Tocá **Vista previa**. Ves los tipos de evento con su duración, cuántas ubicaciones y preguntas trae cada uno, y los horarios con su zona horaria y cantidad de franjas semanales.
5. Confirmá con **Importar**. Al final, **Ir a tipos de evento** te lleva a la lista.

## Qué se importa

**Horarios de disponibilidad.** Cada horario de Calendly entra con su nombre, su zona horaria, sus franjas por día de la semana y sus excepciones por fecha (los días bloqueados y los días con horario distinto). El que es por defecto en Calendly también lo es en Cal.

**Tipos de evento.** De cada uno vienen:

- título, link (slug), duración, descripción y color;
- si está activo o no;
- hasta 20 preguntas, en orden. Texto largo, teléfono, opción única y opción múltiple tienen su tipo equivalente; el resto entra como texto corto. Las preguntas desactivadas en Calendly no se importan;
- las ubicaciones: presencial con su dirección, Zoom, Google Meet, Microsoft Teams, llamada del anfitrión, llamada al invitado y links propios (también los de Webex o GoToMeeting si tienen una URL).

Si una ubicación no tiene equivalente, la vista previa lo dice al lado del tipo de evento ("sin equivalente acá") y ese tipo de evento entra sin ella.

**Reservas próximas (opcional).** Las reservas activas desde el momento del import en adelante, con el nombre, email y zona horaria del invitado, sus respuestas y el link o dirección de la reunión. Entran como confirmadas, a nombre de quien importa, y los invitados **no reciben otro email**: ya tienen la confirmación de Calendly. El import tampoco crea otro evento en tu calendario.

Importar dos veces no duplica: lo que ya entró se saltea.

## Qué no se importa

- **Qué horario usa cada tipo de evento.** Calendly no lo informa, así que todos quedan con el horario por defecto. Cambialo en cada uno si usabas varios.
- **Buffers, aviso mínimo y ventana de reserva.** Cal los tiene, pero hay que configurarlos de nuevo.
- **La marca de secreto.** Un tipo de evento secreto en Calendly entra como uno normal. Si no querés que salga en tu perfil público, marcalo como secreto en Cal.
- **Workflows, formularios de ruteo y cobros.** Cal tiene las tres cosas (workflows con pasos antes y después, routing forms y Stripe), pero se arman de cero.
- **Tipos de evento de otras personas.** El import lee la cuenta dueña del token. Si tu equipo tiene varias cuentas de Calendly, cada persona corre su import, o lo hace un admin con cada token.
- **Reuniones de un solo uso** de Calendly, que no son tipos de evento reutilizables.
- **Reservas pasadas y canceladas.** Solo vienen las próximas activas.
- **Invitados extra.** De cada reserva entra el primer invitado.
- **Links que ya están tomados.** Si un slug ya existe en Cal, se crea con un número al final (`demo-2`) y el informe final te dice cuál cambió.

## En qué orden hacer el cambio

Las reservas importadas siguen vivas también en Calendly: el invitado tiene los links de Calendly para cancelar o reprogramar, y esos cambios no llegan a Cal. Por eso hay dos estrategias razonables:

- **Sin reservas importadas.** Importás solo tipos de evento y horarios, publicás el link de Cal y dejás que las reservas de Calendly se cumplan allá. Es la más prolija.
- **Con reservas importadas.** Te sirve si querés ver toda tu agenda en Cal desde el primer día. Hasta que pase la última reserva importada, mirá Calendly de vez en cuando por si alguien canceló.

Con cualquiera de las dos:

1. **Conectá tu calendario** en **Configuración › Conexiones**. Cal trabaja con Google, Outlook e iCloud, y lo ocupado bloquea horarios.
2. **Revisá cada tipo de evento**: horario, buffers, preguntas y ubicaciones.
3. **Hacé una reserva de prueba** con otro email.
4. **Cambiá los links**: firma de mail, sitio web y embeds. Si tenías el widget de Calendly en tu página, en [cómo embeber Cal en tu sitio](/blog/embeber-cal-en-tu-sitio) está cada opción.
5. **Apagá los tipos de evento en Calendly** cuando ya no quieras reservas nuevas ahí.

## Qué le falta a Cal frente a Calendly

De la tabla de paridad, sin suavizar:

- **Paquetes de reuniones, links de pago y facturas**: todavía no.
- **Tipos de evento gestionados y bloqueados por un admin**: todavía no.
- **SSO SAML y SCIM**: todavía no.
- **Apps de iOS y Android y extensión de navegador**: todavía no. La web funciona a 390 px de ancho.
- **Notetaker con resumen de reuniones y asistente que agenda por email**: todavía no.
- **Cobros**: Stripe con tus claves y reembolso al cancelar; falta PayPal.
- **Zapier y Make**: los eventos de reserva llegan con un webhook, pero no hay app en sus directorios.
- **Roles**: son los del workspace, sin roles propios de agenda.
- **Idiomas de la página de reservas**: inglés, español y portugués. Calendly tiene cinco.

La comparación completa está en [/compare/zerosoft-vs-calendly](/compare/zerosoft-vs-calendly).

## Cuánto cuesta

Calendly Standard cuesta cerca de $12 por usuario por mes: diez personas pagan $1.440 al año. Cal en tu servidor cuesta $0, con el core en AGPLv3. En zerosoft Cloud empezás con un plan gratis y después pagás por uso, que en Cal son las reservas. Los asientos no se cobran.

Si todavía estás decidiendo, leé [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly), con los casos en los que te conviene quedarte.
