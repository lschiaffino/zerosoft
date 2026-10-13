---
title: "SLAs de soporte con Chat: un playbook que entra en una página"
description: "Cómo armar objetivos de tiempo de respuesta en Chat con políticas de SLA, reglas de asignación, horario de atención, prioridades, respuestas guardadas y CSAT — y cómo funciona exactamente el reloj del SLA."
date: "2026-08-11"
author: "Zerosoftware"
tags: ["chat", "soporte", "playbook"]
---

Un SLA es una promesa con cronómetro. "Respondemos en menos de una hora" queda divino en la página de precios y horrible cuando un cliente espera cuatro. El sentido de configurarlo en tu herramienta no es el badge: es que todo el equipo vea, de un vistazo, qué conversación está por romper la promesa.

Así armaríamos SLAs de soporte en Chat para un equipo chico — de dos a ocho personas respondiendo un widget de webchat. Vamos pieza por pieza, en el orden en que conviene configurarlas, y vamos a ser precisos con cómo funciona el reloj, porque ahí es donde la mayoría de los SLAs te mienten.

## Cómo funciona el reloj del SLA

Leé esto primero. Son tres reglas, sacadas del código.

1. **Las políticas de SLA son por widget y por prioridad.** Cada widget puede tener una política para cada una de las cuatro prioridades: `low`, `medium`, `high`, `urgent`. Una política tiene un objetivo de **primera respuesta** en minutos y un objetivo opcional de **resolución** en minutos (de 1 minuto hasta 30 días).
2. **Sin política, hay un default.** Si un widget no tiene política para la prioridad de una conversación, la primera respuesta vale **60 minutos** y no hay objetivo de resolución.
3. **El reloj arranca cuando se crea la conversación y corre en tiempo real de reloj.** La primera respuesta se marca la primera vez que responde un agente (un mensaje o un adjunto). La resolución se marca cuando la conversación pasa a resuelta. La respuesta automática del bot **no** cuenta como primera respuesta — una máquina contestando con un texto guardado no es la promesa.

Dos consecuencias que conviene saber de entrada:

- **El horario de atención no pausa el reloj.** Si alguien escribe a las 23 y tu objetivo de primera respuesta es 60 minutos, a la medianoche esa conversación figura como incumplida. Más abajo lo resolvemos.
- **El snooze tampoco lo pausa.** Snoozear oculta una conversación hasta la hora que elijas (después se reabre sola), pero el SLA sigue contando desde la creación.

En el inbox, cada conversación abierta lleva un badge: "Reply in 23m" mientras está en tiempo, "Breached" cuando ya no — y te dice si lo que se rompió fue el SLA de primera respuesta o el de resolución.

## Paso 1: definí objetivos por prioridad

Las conversaciones nuevas arrancan en **medium**. Los agentes cambian la prioridad desde la vista de la conversación. En la práctica, medium es "todo" y las otras tres son excepciones que marca un agente. Un punto de partida razonable para un equipo chico, a modo de ejemplo hipotético:

| Prioridad | Primera respuesta | Resolución |
| --- | --- | --- |
| urgent | 15 min | 4 h |
| high | 30 min | 1 día |
| medium | 2 h | ninguna |
| low | 1 día | ninguna |

Después cargalos en **Chat → tu widget → SLA**: una fila por prioridad, minutos de primera respuesta, minutos de resolución (dejalo vacío si no querés objetivo). Guardar una política para una prioridad reemplaza la anterior.

Sé honesto con estos números. Un objetivo que incumplís todos los días entrena al equipo a ignorar el badge.

## Paso 2: horario de atención, y un reloj justo

En la configuración del widget, activá **Horario de atención**: una zona horaria y una hora de inicio y fin para cada día de la semana. Fuera de ese horario, el widget le muestra al visitante un aviso de ausencia con cuándo volvés. Eso pone bien la expectativa del cliente.

Como el reloj del SLA no sabe de horarios, tenés dos opciones honestas:

- **Mantener objetivos de reloj corrido y aceptar incumplimientos nocturnos.** Simple, y el incumplimiento es un hecho real: alguien esperó.
- **Dimensionar medium y low para cubrir la noche.** Si cerrás 14 horas, un objetivo de primera respuesta de, digamos, 16 horas para medium significa "a la mañana siguiente" sin mentir. Dejá objetivos ajustados solo para urgent y high, que un agente marca cuando está en turno.

Para la mayoría de los equipos chicos elegiríamos la segunda. Un cálculo de SLA que entienda el horario laboral es algo que queremos sumar; hoy no está.

## Paso 3: reglas de asignación, para que nadie mire una cola sin dueño

Las conversaciones sin asignar son donde los SLAs van a morir. En **Chat → tu widget → Reglas**, agregá reglas que corren en orden, de arriba hacia abajo. La primera que matchea asigna la conversación. Hay cuatro tipos:

- **Keyword** — el mensaje del visitante contiene una palabra, sin importar mayúsculas. Ejemplo: `reembolso` va a quien maneja facturación.
- **Rango horario** — la hora actual cae en una ventana como `09:00-13:00`. Sirve para turnos. Ojo: usa el reloj del servidor, no la zona horaria del horario de atención del widget, así que fijate en qué zona corre tu servidor.
- **Round-robin** — asigna al miembro del equipo con menos conversaciones asignadas en ese widget.
- **Catch-all** — matchea siempre; ponela última como red de seguridad.

Las reglas solo tocan conversaciones sin dueño: nunca pisan una asignación manual. Un stack por defecto sólido: un par de reglas de keyword para especialistas, después round-robin, después catch-all a un líder.

## Paso 4: respuestas guardadas para ganar tiempo en la primera respuesta

La mayoría de las primeras respuestas son alguna versión de "recibido, lo estoy viendo" o una respuesta estándar a una pregunta estándar. Cargalas en **Chat → tu widget → Respuestas guardadas**, cada una con un atajo, un título y un cuerpo.

En la caja de respuesta, escribí `/` seguido de parte del atajo o del título — `/reembolso`, por ejemplo — y elegí de la lista. El texto cae en el editor y lo podés retocar antes de mandar. Una primera respuesta real en diez segundos es la mejora de SLA más barata que existe.

Una regla: las respuestas guardadas acusan recibo, no patean la pelota. Un "te escribimos en breve" mandado para frenar el reloj y después olvidado es peor que un incumplimiento.

## Paso 5: el bot, con cuidado

Chat tiene un bot de respuesta automática, y seamos claros sobre qué es: **matching por palabras clave, no un LLM**. Compara las palabras del visitante con tus respuestas guardadas o con tus páginas de Docs (las coincidencias en el título valen doble), y responde una sola vez por conversación, solo si nadie contestó todavía. Sin coincidencia, manda solo el saludo.

Sirve para desviar preguntas tipo "¿en qué horario atienden?". Como no cuenta como primera respuesta, no te maquilla los números — que es exactamente como debería ser.

## Paso 6: CSAT, la otra mitad del SLA

Rápido y mal sigue siendo mal. Cuando una conversación se resuelve, el widget le pide al visitante que la califique de 1 a 5, con un comentario opcional. El puntaje aparece en la conversación.

## Paso 7: mirá los números cada semana

**Chat → Configuración** muestra, sumando tus widgets: tiempo promedio de primera respuesta, porcentaje de conversaciones dentro del SLA de primera respuesta, tiempo promedio de resolución, cantidad de conversaciones resueltas, y promedio de CSAT con cantidad de respuestas (sobre las 1.000 conversaciones más recientes).

Con una revisión semanal de quince minutos alcanza: si baja el porcentaje dentro del SLA, mirá qué prioridad y qué horarios. Si baja el CSAT mientras los SLAs se cumplen, tu problema no es la velocidad.

## Lo que todavía no está

Para que el playbook sea honesto: no hay reloj de SLA que entienda el horario laboral, no hay escalamiento automático ni alerta por email cuando un SLA está por romperse (el badge y el inbox son la alerta), no hay agente de IA y no hay exportación de conversaciones. Si tu operación de soporte depende de eso, hoy te conviene un help desk maduro. Para un equipo chico que quiere promesas claras y una vista compartida de quién viene atrasado, alcanza — gratis si lo hosteás vos, o en Zerosoft Cloud con un tier gratuito.
