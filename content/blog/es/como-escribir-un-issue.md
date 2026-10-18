---
title: "Cómo escribir un issue que alguien pueda terminar"
description: "Reglas para títulos, descripciones y tamaño de un issue, con tres plantillas de texto para bugs, tareas e investigaciones, y cómo usar sub-issues, relaciones y estimaciones en Track."
date: "2026-10-18"
author: "zerosoft"
tags: ["track", "issues", "plantillas"]
---

El Linear Method tiene un capítulo que vale la pena leer: [escribí issues, no user stories](https://linear.app/method/write-issues-not-user-stories). El argumento es que el formato "como usuario quiero…" se volvió un ritual que esconde el trabajo, y que un issue tiene que describir una tarea concreta con un resultado claro.

Estamos de acuerdo. Pero "una tarea concreta" es fácil de decir y difícil de escribir un martes a las seis de la tarde. Este post baja la idea a reglas que se pueden chequear y a tres plantillas para pegar, pensadas para un equipo chico donde la misma persona escribe el issue, lo hace y lo cierra.

## La prueba de un issue bien escrito

Antes de guardar un issue, hacete tres preguntas:

1. **¿Se sabe cuándo está terminado?** Si dos personas pueden discutir si está hecho, falta el criterio.
2. **¿Entra en dos o tres días de trabajo?** Si no, son varios issues.
3. **¿Alguien que no estuvo en la reunión lo puede empezar?** Si necesita "preguntale a Juan", falta contexto.

Un issue que pasa las tres casi siempre se termina. Uno que falla en alguna se queda semanas en In progress.

## Títulos: un verbo y un objeto

El título se lee en listas, en el board y en el inbox, muchas veces sin abrir el issue. Tiene que decir qué se hace.

| Antes | Después |
|---|---|
| Login | Mostrar el error de contraseña debajo del campo |
| Bug en exportación | El CSV de contactos sale sin la columna de email |
| Mejorar onboarding | Saltear el paso de equipo si el usuario es solo |
| Ver tema pagos | Investigar si Mercado Pago permite cobros recurrentes |

Tres reglas:

- **Empezá con un verbo** para las tareas ("Agregar", "Mover", "Borrar"). Para los bugs, describí el síntoma tal como lo ve el usuario.
- **Nada de prefijos** como `[BUG]` o `FRONT:`. Para eso están las etiquetas. En Track son del workspace, se comparten entre proyectos y cada issue puede tener hasta 10.
- **Menos de diez palabras.** Si no entra, probablemente son dos issues.

## Descripciones: lo justo para empezar

Una buena descripción es corta. Tiene el contexto que la persona necesita para arrancar y el criterio para saber que terminó. El resto (la discusión de producto, las alternativas, el porqué estratégico) va en un documento aparte, linkeado.

En Track la descripción es texto plano, hasta 5.000 caracteres. Y Track todavía no tiene plantillas de issue. Nuestro workaround: guardá las tres plantillas de abajo en una página de Docs llamada "Plantillas de issues" y copialas cuando las necesitás.

### Plantilla 1: bug

```
Qué pasa:
El CSV de contactos se descarga sin la columna email.

Cómo reproducirlo:
1. CRM > Contactos > Exportar
2. Abrir el archivo

Qué debería pasar:
La primera columna es email, como en la vista de la tabla.

Dónde:
Chrome 129, workspace de prueba. Reportado por un cliente por Chat.

Lo que dijo el cliente (textual):
"Exporto y no me aparecen los mails, tengo que copiarlos a mano."
```

La última sección importa. Pegá las palabras del cliente tal cual, sin resumirlas. Cuando el issue llega por triage desde Chat o Flow, la descripción trae lo que cargó el agente o el flujo; si falta el mensaje textual del cliente, copialo de la conversación antes de aceptar el issue.

### Plantilla 2: tarea

```
Por qué:
Los usuarios solos ven un paso de "Invitá a tu equipo" que no aplica.

Qué hay que hacer:
Si el workspace tiene un solo miembro, saltear el paso 3 del onboarding.

Está terminado cuando:
- Un usuario nuevo sin equipo llega del paso 2 al 4.
- Un usuario con equipo sigue viendo el paso 3.

Fuera de alcance:
Rediseñar el paso 3.
```

"Está terminado cuando" es la sección que más ahorra. "Fuera de alcance" es la que evita que una tarea de un día se convierta en una de una semana.

### Plantilla 3: investigación

```
Pregunta:
¿Mercado Pago permite suscripciones con cobro automático en Argentina y México?

Para decidir:
Si sumamos suscripciones al checkout este trimestre.

Entregable:
Un comentario en este issue con sí/no por país, link a la documentación y una estimación del trabajo.

Tiempo máximo: 1 día.
```

Las investigaciones son issues legítimos, siempre que tengan una pregunta, un entregable y un límite de tiempo. Sin límite, se convierten en el issue más viejo del board.

## Quién escribe el issue

La persona que va a hacer el trabajo es la que mejor lo describe, y escribirlo la obliga a pensarlo. En un equipo chico la regla práctica es:

- **Si es tuyo, lo escribís vos.**
- **Si encontraste un bug de otro**, describí el síntoma y asignáselo. Que la solución la escriba quien la va a hacer.
- **Si lo pide un cliente**, el issue entra con sus palabras (por triage o a mano) y el responsable lo convierte en tarea.

## Tamaño: estimaciones y sub-issues

Track acepta estimaciones en números enteros, sin una escala impuesta. Elegí una y sostenela. Nosotros usamos 1, 2, 3 y 5, donde 5 es el máximo: todo lo que pase de 5 se parte.

Para partir, usá **sub-issues**. Desde cualquier issue creás uno hijo, que es un issue completo con su estado, responsable y estimación. El padre queda como paraguas y muestra sus hijos. Una regla útil: el padre no se estima, se estiman los hijos.

Ejemplo, `APP-40` "Suscripciones en el checkout" (sin estimar):

- `APP-41` Guardar la suscripción de Mercado Pago en el pedido (3)
- `APP-42` Mostrar el estado del cobro en el detalle del pedido (2)
- `APP-43` Mandar el email de cobro fallido (2)

## Dependencias: relaciones, no párrafos

"Esto depende de lo de pagos" escrito en la descripción se pierde. Track tiene tres relaciones: **bloquea**, **relacionado con** y **duplica**. Se agregan desde el detalle escribiendo el identificador del otro issue, y aparecen en los dos lados: si `APP-41` bloquea `APP-42`, el segundo muestra "bloqueado por". En la vista **Cronograma** (Gantt) podés ver si un issue bloqueado está programado antes que el que lo bloquea.

## Del issue al código

Si usás la integración de GitHub, el detalle del issue tiene **Copiar nombre de branch**, que arma `app-41-guardar-la-suscripcion-de-mercado-pago-en-el-pedid` a partir del identificador y el título. El título se corta a 50 caracteres, otra razón para escribirlo corto: termina siendo el nombre del branch. Con `fixes APP-41` en la descripción del PR, el merge puede mover el issue a Hecho, si lo configuraste así.

## Checklist para pegar en la wiki

- [ ] El título empieza con un verbo o describe un síntoma, en menos de diez palabras.
- [ ] La descripción dice cuándo está terminado.
- [ ] Entra en dos o tres días; si no, tiene sub-issues.
- [ ] Las palabras del cliente están textuales.
- [ ] Las dependencias están como relaciones.
- [ ] Tiene prioridad, responsable y, si hay fecha real, vencimiento.

Si tu equipo ya usa Docs, esta lista entra en la misma página que las plantillas. Track y Docs corren en tu servidor por $0 o en zerosoft Cloud. Cuando Track tenga plantillas de issue propias, la página de Docs va a sobrar, y lo vamos a contar en el changelog.
