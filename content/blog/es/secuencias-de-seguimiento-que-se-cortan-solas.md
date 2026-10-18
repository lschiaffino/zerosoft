---
title: "Seguimiento de ventas: una secuencia de cinco toques que se corta sola"
description: "Una cadencia de seguimiento de dos semanas con emails, una tarea y esperas en días hábiles, los textos para copiar y cómo se arma en las secuencias del CRM de zerosoft."
date: "2026-10-18"
author: "zerosoft"
tags: ["crm", "ventas", "email", "plantillas"]
---

Los seguimientos fallan de dos maneras. La primera: nadie los manda, porque el recordatorio estaba en la cabeza de alguien. La segunda, más cara: salen igual cuando el contacto ya respondió o ya agendó, y el tercer "¿pudiste ver mi email?" le llega a alguien que ayer te dijo que sí.

HubSpot tiene una página muy visitada con [16 plantillas de email de seguimiento](https://www.hubspot.com/sales/sales-follow-up-email), ordenadas por situación: después de una reunión, después de un evento, después de varios intentos. Sirven como inspiración para un email suelto. Lo que no te dan es la cadencia completa: cuántos toques, con qué espera y, sobre todo, cuándo frenar. Este post arma eso: una secuencia de dos semanas con los textos y la configuración en el CRM de zerosoft.

## Qué hace una secuencia en el CRM

Lo justo para que las decisiones de abajo tengan sentido:

- **Tres tipos de paso:** email (desde una plantilla o escrito ahí), tarea y espera de N días.
- **Mismo hilo por defecto.** Cada email sale como respuesta en el hilo del primero, con "Re:" y las cabeceras correctas. Podés marcar un paso para que empiece un hilo nuevo.
- **Días hábiles y horario de envío.** La secuencia tiene zona horaria, una ventana (por ejemplo, de 9 a 17) y la opción de saltear sábados y domingos. Un email que vence a las 22 sale a las 9 del día hábil siguiente.
- **Salidas automáticas.** La inscripción se corta si el contacto responde (lo detecta el sync de Gmail), si agenda una reunión en Cal o si se da de baja con el link del pie. Esa es la parte que evita el segundo error del principio.
- **Variables con respaldo.** `{{contact.first_name | ahí}}` pone el nombre o, si falta, "ahí". También hay empresa, cargo, nombre del deal, datos del responsable y campos personalizados.

Dos detalles operativos. Los pasos corren desde un cron que pasa cada hora, así que un email sale dentro de la hora en que vence. Y los emails salen del Gmail de quien inscribe al contacto: hace falta conectar Gmail, y mientras Google no termine de verificar la app solo pueden conectarlo usuarios de prueba.

## La cadencia: cinco toques en dos semanas

| Día hábil | Paso | Qué busca |
|---|---|---|
| 0 | Email 1 | Contexto y una pregunta |
| 2 | Email 2, mismo hilo | Algo útil, sin pedir nada nuevo |
| 5 | Tarea: llamada o mensaje por LinkedIn | Cambiar de canal |
| 7 | Email 3, mismo hilo | Otro ángulo del problema |
| 12 | Email 4, mismo hilo | Cierre: ¿sigo o no? |

En el editor queda así: email, espera 2, email, espera 3, tarea, espera 2, email, espera 5, email. Una aclaración: el paso de tarea crea la tarea para el responsable y la secuencia sigue de inmediato con el paso siguiente. Por eso después de la tarea va una espera; si no, el email 3 saldría en el mismo minuto.

¿Por qué cinco toques? Ninguna razón universal. La página de HubSpot repite que la mayoría de las ventas necesita al menos cinco seguimientos, pero no linkea el estudio, así que no vamos a usar ese número como argumento. Arrancá con cinco y dejá que tus estadísticas decidan (ver abajo).

## Los textos

Escritos para B2B en español; adaptalos a tu producto. Una regla para todos: un pedido por email, como máximo.

**Email 1. Asunto: `{{contact.company}} y [tema]`**

> Hola {{contact.first_name | ahí}}, vi que [hecho concreto: llenaron el formulario de precios, abrieron una vacante de ventas, usan X]. En equipos parecidos, lo que suele trabar es [problema concreto]. ¿Les pasa algo así? Si sí, te cuento en diez minutos cómo lo resolvemos.
> {{owner.first_name}}

**Email 2 (mismo hilo)**

> Te dejo [recurso concreto: una plantilla, una comparación de costos, un caso con números]. Es útil aunque no hablemos nunca. Si te sirve, la pregunta de arriba sigue en pie.

**Tarea: "Llamar o escribir por LinkedIn a {{contact.full_name}}"**

En las notas de la tarea, dejá el guion de dos líneas: quién sos y la misma pregunta del email 1. Un canal distinto no justifica un mensaje distinto.

**Email 3 (mismo hilo)**

> Otra forma de verlo: [el costo del problema, con un número que el contacto pueda verificar]. Si no es prioridad este trimestre, decime y te escribo más adelante.

**Email 4 (mismo hilo)**

> No quiero llenarte la bandeja. Si no es el momento, respondé "ahora no" y cierro el tema. Si es otra persona la que ve esto en {{contact.company}}, ¿me decís quién?

Tres cosas que no van en ninguno: "solo quería hacer seguimiento", un "Re:" falso en un email que no es respuesta y un archivo adjunto pesado en el primer toque.

## A quién inscribir y desde dónde

Una secuencia es para gente que mostró alguna intención o que encaja muy bien. Las vías de entrada en el CRM:

- **Desde la ficha del contacto o en lote** desde la lista, con la barra de acciones. Los que ya están inscriptos, dados de baja o sin email se omiten y el CRM te dice cuántos.
- **Desde un formulario:** cada envío puede inscribir al contacto en una secuencia.
- **Desde un workflow:** por ejemplo, cuando el lead score cruza 30 hacia arriba. Armamos esas reglas en [lead scoring con reglas](/blog/lead-scoring-con-reglas).
- **Desde Flow o la API**, si la señal viene de otro sistema.

## Leé las estadísticas por paso

La secuencia muestra enviados, abiertos, con click y respondidos para cada paso. Después de 30 o 40 inscriptos, tres preguntas:

1. **¿Qué paso junta más respuestas?** Si es el email 4, los anteriores piden demasiado o dicen poco. Reescribí el 2 antes de agregar un sexto toque.
2. **¿Cuántos salen antes de terminar?** La lista de inscripciones dice el motivo de cada salida: respondió, agendó una reunión, se dio de baja. Muchas bajas en el email 3 suelen indicar una lista mal elegida. Revisá a quién inscribiste antes de tocar el texto.
3. **¿Los clicks se convierten en respuestas?** Si hay clicks en el recurso del email 2 y nadie responde, la pregunta de cierre no conecta con lo que leyeron.

Tomá las aperturas con pinzas: Apple Mail precarga imágenes y registra aperturas que no ocurrieron.

## Lo que todavía no hace

- Solo Gmail. Outlook no está.
- No hay pruebas A/B de asunto ni de cuerpo dentro de una secuencia. Si querés comparar, duplicá la secuencia y repartí los inscriptos a mano.
- Los pasos salen con una granularidad de una hora.
- La tarea de LinkedIn es una tarea: no automatizamos mensajes en otras plataformas.

Las secuencias corren en el CRM de zerosoft por $0 en tu servidor o en zerosoft Cloud, donde se paga por emails enviados y no por asiento.
