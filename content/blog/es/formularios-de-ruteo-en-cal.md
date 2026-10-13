---
title: "Formularios de ruteo en Cal: cada lead a la reunión correcta"
description: "Un par de preguntas antes del calendario y cada visitante cae en el event type que corresponde. Cómo armar routing forms en Cal, cómo se evalúan las reglas y dónde están los límites."
date: "2026-08-03"
author: "Zerosoftware"
tags: ["cal", "agendar", "ventas"]
---

Un solo link de reservas para todo el mundo suena simple hasta que tu mejor vendedor senior se pasa el martes a la tarde en una llamada con un estudiante que quería un descuento. O tu prospecto enterprise cae en un slot de 15 minutos de "charla rápida" con un junior.

La solución es vieja y aburrida: hacer un par de preguntas *antes* de mostrar el calendario y mandar a cada uno al lugar correcto. En Cal se llaman **routing forms**. Acá va cómo armar uno y cómo decide Cal, exactamente, a dónde va cada visitante.

## Las piezas

Un routing form tiene tres partes:

- **Preguntas.** Los campos que completa el visitante. Tres tipos: **Text**, **Select** (un desplegable con hasta 50 opciones) y **Yes / No**. Cada pregunta tiene un label (lo que ve la gente), una key (a la que se refieren las reglas, en minúsculas, tipo `company_size`) y puede marcarse como obligatoria.
- **Reglas.** Cada regla dice: *si la pregunta X* — **is**, **is not**, **contains** o **is answered** — *el valor Y, mandalo al event type Z*.
- **Un event type por defecto.** A dónde va la gente si ninguna regla matchea.

El form tiene su propia URL pública, `/r/<tu-handle>/<slug>`, que compartís en lugar de un link de reserva. Cuando el visitante envía, Cal evalúa las reglas y lo redirige a `/book/<tu-handle>/<event-slug>` del event type que corresponda.

## Armando uno, paso a paso

Un caso hipotético: una agencia B2B de 6 personas que vende proyectos web y además recibe un goteo constante de gente pidiendo soporte para sitios que ya existen.

**1. Creá primero los event types de destino.** Los routing forms apuntan a event types, así que tienen que existir. Por ejemplo:

- `discovery-call` — 45 min, con los dos fundadores en un pool round-robin,
- `intro-call` — 20 min, con un account manager junior,
- `support-triage` — 15 min, con quien se ocupe del soporte.

**2. Creá el form.** Andá a **Cal → Routing forms → New routing form**. Ponele título y slug, por ejemplo `hablemos`.

**3. Agregá las preguntas.**

- `name` — Text, obligatoria
- `email` — Text, obligatoria
- `need` — Select: *Sitio nuevo*, *Rediseño*, *Soporte para un sitio existente*
- `budget` — Select: *Menos de 5k*, *5k–20k*, *Más de 20k*

**4. Agregá las reglas, en orden.**

1. `need` **is** *Soporte para un sitio existente* → `support-triage`
2. `budget` **is** *Más de 20k* → `discovery-call`
3. `budget` **is** *5k–20k* → `discovery-call`

**5. Definí el default**: `intro-call`.

Ahora quien tiene un sitio existente siempre va a soporte, sin importar el presupuesto. Los proyectos grandes van a los fundadores. El resto, a la intro de 20 minutos.

## Cómo se evalúan las reglas de verdad

Esta es la parte que la mayoría de los docs explica a las apuradas. Esto hace `lib/calendar-routing.ts`:

- **Las reglas corren en orden, de arriba hacia abajo. Gana la primera que matchea.** Las siguientes ni se miran. Por eso la regla de soporte va primera en el ejemplo: el orden es tu sistema de prioridades.
- **Las comparaciones ignoran mayúsculas y espacios de los costados.** "Más de 20K " matchea con "más de 20k". Útil en campos de texto donde la gente escribe lo que quiere.
- **`contains`** busca una subcadena, también sin distinguir mayúsculas. Sirve para preguntas de texto: `company` contains `universidad`.
- **`is answered`** matchea cuando la respuesta no está vacía y no significa "no": `false`, `0`, `no` o vacío no cuentan. En una pregunta Yes / No, en la práctica es "es sí".
- **Una respuesta ausente nunca matchea `is not`.** Si alguien salteó una pregunta opcional, `budget is not Menos de 5k` *no* se dispara. Una regla no puede comparar contra la nada, así que se saltea. Esto sorprende a más de uno, así que diseñá en consecuencia: hacé la pregunta obligatoria o ruteá con condiciones positivas.
- **Los destinos inactivos se saltean.** Si una regla apunta a un event type que desactivaste o borraste, Cal pasa a la siguiente regla en vez de mandar al visitante a una página muerta. Con el default pasa lo mismo.
- **Sin ruta, no hay redirect.** Si nada matchea y no hay un default activo, el visitante ve "Ninguna página de reserva coincide con tus respuestas." Definí siempre un default.

Las preguntas obligatorias se validan también en el servidor, no solo en el navegador.

## Lo que hace que funcione mejor

**Usá las keys `name` y `email`.** Si tu form tiene preguntas con exactamente esas keys, Cal pasa las respuestas como `?name=…&email=…` a la página de reserva, y el visitante no las escribe dos veces. El resto de las respuestas hoy no viaja a la reserva: si las necesitás en el booking, agregalas también como preguntas personalizadas del event type.

**Combinalo con round-robin.** La regla elige el *event type*; el pool de hosts del event type elige a la *persona*. Ruteo más [round-robin](/blog/round-robin-con-cal) es como lográs "los leads enterprise rotan entre los dos seniors, el resto rota entre los demás".

**Mantené cortas las listas de reglas.** De tres a seis reglas cubren la mayoría de los casos reales. Si tenés veinte, probablemente necesitás dos forms.

**Probalo como visitante.** Abrí la URL pública en una ventana privada y recorré cada rama. No hay un simulador de reglas en la UI, así que esta es tu suite de tests.

## Del lado de la API

El form público se apoya en una API chiquita que podés llamar desde tu propio frontend si preferís armar un form a medida:

```bash
# Form definition (questions, types, options — no routing targets exposed)
curl https://zerosoft.ai/api/calendar/routing/<form-id>/route

# Evaluate answers
curl -X POST https://zerosoft.ai/api/calendar/routing/<form-id>/route \
  -H "Content-Type: application/json" \
  -d '{"answers": {"name": "Ana", "email": "ana@example.com", "need": "Redesign", "budget": "Over 20k"}}'
# → {"eventTypeSlug": "discovery-call", "bookPath": "/book/your-handle/discovery-call"}
```

El `GET` a propósito no revela a dónde manda cada regla. Los dos endpoints tienen rate limit por IP.

## Lo que los routing forms (todavía) no hacen

Sin vueltas sobre los límites:

- **Cada regla tiene una sola condición.** No hay grupos AND/OR. Podés aproximar un AND ordenando bien las reglas, pero la lógica compleja se vuelve incómoda.
- **Los destinos son solo tus propios event types.** No podés rutear a una URL externa ni al event type de otra persona.
- **No consulta el CRM.** Los planes pagos de Calendly pueden rutear según datos de tu CRM, tipo "cliente existente va a su account owner". Cal rutea solo con lo que escribió el visitante.
- **No hay analytics del form.** Ves las reservas, no cuánta gente completó el form y se fue.

Para un equipo chico que solo quiere a la gente correcta en las llamadas correctas, suele alcanzar. Para un equipo de revenue con reglas de territorio complejas, sé honesto con vos mismo sobre si las reglas de una condición van a aguantar.
