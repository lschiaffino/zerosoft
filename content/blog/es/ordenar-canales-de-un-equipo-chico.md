---
title: "Cómo ordenar los canales de un equipo chico: nombres, secciones y archivo"
description: "Una convención de nombres de una página, qué canales crear primero, cuándo archivar y cómo armar tus secciones en Talk, el chat open source de zerosoft."
date: "2026-11-22"
author: "zerosoft"
tags: ["talk", "slack", "guía"]
---

Un workspace de chat con diez personas arranca con tres canales y, a los seis meses, tiene cuarenta. Nadie sabe cuál es el correcto para preguntar por una factura, tres canales se llaman casi igual y el de "ideas" no recibe un mensaje desde marzo. Casi siempre falta lo mismo: alguien que escriba cómo se nombra, cuándo se crea y cuándo se cierra un canal.

Slack tiene [una guía sobre cómo organizar canales](https://slack.com/blog/collaboration/how-to-use-slack-channels-to-organize-your-work) que recomienda, entre otras cosas, usar prefijos para que el propósito de cada canal se lea en el nombre. Es un buen punto de partida. Acá va nuestra versión para equipos de entre cinco y veinte personas, con lo que hace Talk para cada paso. Talk es el chat de zerosoft: canales públicos y privados, hilos, huddles, canvas y listas, con licencia AGPL y la opción de correrlo en tu propio servidor.

## Antes de crear nada: tres preguntas

Cada vez que alguien quiera crear un canal, que responda:

1. **¿Quién tiene que leerlo?** Si la respuesta es "todos", probablemente ya existe (`general`).
2. **¿Cuándo se termina?** Un proyecto con fecha de fin es un canal con fecha de archivo. Un tema permanente (ventas, soporte) no.
3. **¿Se puede decir en una frase para qué sirve?** Si no, todavía no es un canal, es una conversación.

Con eso solo, la cantidad de canales baja a la mitad.

## Una convención de nombres de una página

Talk normaliza los nombres al crearlos: minúsculas, espacios convertidos en guiones, sin símbolos y hasta 80 caracteres. Además no deja repetir un nombre en el workspace, tanto entre públicos como privados. Esa normalización te ayuda, pero el prefijo lo elegís vos. Proponemos cuatro:

| Prefijo | Para qué | Ejemplo |
|---|---|---|
| `eq-` | Un equipo o función | `eq-ventas`, `eq-soporte` |
| `proy-` | Un proyecto con fecha de fin | `proy-rediseno-web`, `proy-lanzamiento-q1` |
| `cli-` | Un cliente o cuenta | `cli-panaderia-lopez` |
| `ayuda-` | Pedir ayuda sobre un tema | `ayuda-facturacion`, `ayuda-infra` |

Más dos canales sin prefijo: `general` (Talk lo crea solo en cada workspace) y `anuncios` para lo que todos tienen que leer. Si querés uno social, `social-` y listo.

Dos reglas que ahorran discusiones: el separador es siempre el guion, y el nombre va en singular y sin fechas. `proy-lanzamiento` envejece mejor que `proy-lanzamiento-nov-2026`.

Escribí la convención en un documento corto y dejala a mano. Si usás zerosoft Docs, una página en el workspace alcanza. Y ponela también como marcador del canal `general` (más abajo cómo).

## Qué escribir en el tema y la descripción

Al crear un canal en Talk podés completar un **tema** (hasta 250 caracteres) y una **descripción** (hasta 1000). Usalos distinto:

- **Tema:** una línea que dice para qué es el canal y qué no va ahí. Ejemplo: `Pedidos de soporte de clientes. Los bugs se reportan en Track.`
- **Descripción:** quién lo mira, en qué horario se responde, enlaces a lo importante.

Podés cambiar el tema en cualquier momento con el comando `/topic` desde el mismo canal. La búsqueda del directorio de canales mira el nombre, el tema y la descripción, así que un buen tema también hace que la gente encuentre el canal sin preguntar.

## Marcadores y mensajes fijados

Cada canal tiene una barra de marcadores debajo del encabezado. Cualquier miembro agrega, edita o borra links (hasta 50 por canal, solo http y https). Reglas de uso que funcionan:

- En `eq-ventas`: el pipeline del CRM, la plantilla de propuesta, la lista de precios.
- En `proy-*`: el brief, el tablero en Board, la carpeta de entregables.
- En `general`: la convención de nombres y el calendario del equipo.

Los **mensajes fijados** son para decisiones, no para charla: "Elegimos el proveedor X, motivo en este hilo". Talk muestra hasta 100 fijados por canal, pero un canal con más de cinco ya no está fijando nada.

## Secciones propias en el sidebar

Aunque la convención sea buena, cada persona mira distinto. En Talk cada quien arma sus **secciones**: las crea, las renombra, las ordena entre sí y mueve canales y mensajes directos adentro desde el menú de cada uno. Hay hasta 30 por persona, y cada sección se puede ordenar de la A a la Z o por actividad reciente. Nadie más ve tus secciones.

Una configuración que le sirve a casi todos:

1. **Destacados:** los tres o cuatro canales que abrís a diario.
2. **Clientes:** todos los `cli-*`, ordenados por actividad.
3. **Proyectos:** todos los `proy-*`, de la A a la Z.
4. **Silencio:** `social-*` y lo que revisás una vez al día.

Como las secciones son personales, el desorden de uno no ensucia al resto.

## Cuándo archivar

Archivar es la parte que más se saltea. Una regla simple: **un canal `proy-*` se archiva dentro de la semana en que termina el proyecto**, y un canal sin mensajes en 60 días se pregunta en `general` si alguien lo necesita.

En Talk, archivar no borra nada: el canal deja de aceptar mensajes, sale del sidebar y se puede restaurar. Los canales archivados se listan en el directorio de canales con el filtro de archivados, así que el historial sigue ahí para buscarlo. Quien creó el canal, un admin del canal o un admin del workspace puede archivarlo, renombrarlo, pasarlo a privado o borrarlo.

Algo que todavía no hacemos: convertir un mensaje directo grupal en un canal privado. Si una charla de cuatro personas se vuelve permanente, hoy hay que crear el canal y avisar.

## Una revisión de 15 minutos por trimestre

Pongan en el calendario una vez cada tres meses:

1. Abrí el directorio de canales y ordená por nombre. Mirá si hay nombres que no cumplen la convención y renombralos.
2. Listá los candidatos a archivar. Preguntá en `general` con un plazo de una semana.
3. Revisá que cada canal vivo tenga tema.
4. Borrá los marcadores rotos.

## Qué cambia cuando el chat es parte de una suite

En un chat aislado, el canal de un cliente y el tablero de ese cliente son dos mundos. En zerosoft, los canales conviven con CRM, Track, Board y Docs en el mismo workspace, con la misma gente y los mismos permisos. Eso permite que un marcador de `cli-panaderia-lopez` apunte directo al deal del CRM y que el issue de Track de un pedido quede a un clic del canal donde se habló.

Y como no cobramos por asiento, sumar a la contadora externa o a un freelance como invitado a un solo canal no cambia la cuenta. Podés probarlo en zerosoft Cloud o correr Talk en tu servidor: el core es AGPLv3 con todas sus funciones, y tus conversaciones quedan en tu base de datos.

## Resumen para pegar en `general`

```
Canales: eq-, proy-, cli-, ayuda-, social-
Separador: guion. Singular. Sin fechas.
Cada canal tiene tema (qué es y qué no).
Proyectos: se archivan la semana que terminan.
Cada tanto revisamos el directorio.
Dudas: preguntá en #general antes de crear.
```
