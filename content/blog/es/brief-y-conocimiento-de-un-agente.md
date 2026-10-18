---
title: "Cómo escribir el brief y el conocimiento de un agente de soporte"
description: "Una plantilla de brief para un agente de IA, cómo escribir páginas de Docs que la búsqueda encuentre y un método de prueba con preguntas reales antes de publicarlo."
date: "2026-10-18"
author: "zerosoft"
tags: ["agents", "ia", "docs", "soporte"]
---

Un agente de soporte responde tan bien como dos textos que escribís vos: las instrucciones, que le dicen cómo trabajar, y el conocimiento, que le dice qué es verdad sobre tu negocio. La mayoría de los agentes que responden mal tienen un problema en uno de los dos, y casi nunca en el modelo.

Intercom publicó [cómo prepararon su centro de ayuda para Fin](https://www.intercom.com/help/en/articles/7269326-how-to-optimize-your-help-center-for-fin): auditar artículos viejos, probar con un grupo chico de clientes y escribir lo que faltaba. Lindy tiene una [guía de prompts](https://docs.lindy.ai/fundamentals/lindy-101/prompt-guide) para sus agentes. Las dos sirven. Este post agrega lo que solo se puede decir mirando el código: cómo busca Agents en tu conocimiento, y qué cambia eso en la forma de escribir.

## Parte 1: el brief

Las instrucciones de un agente admiten hasta 12.000 caracteres. No hace falta usarlos. Un buen brief entra en una pantalla y tiene seis partes:

```
Rol: Sos el asistente de soporte de Acme, un software de turnos para clínicas.

Objetivo: resolver consultas de clientes sobre el uso del producto,
en el primer mensaje cuando se pueda.

Cómo trabajar:
- Antes de responder sobre el producto, precios o políticas, buscá en el conocimiento.
- Respondé en 1 a 4 oraciones. Si explicás cómo hacer algo, usá pasos numerados.
- Si el cliente reporta un error, pedí qué hizo, qué pasó y su email,
  y creá un issue en Track con esos datos.

Cuándo derivar:
- Reembolsos, bajas o facturación: siempre a una persona.
- Si no encontrás la respuesta, decilo y derivá.

Lo que no hacés: no das consejos médicos ni hablás de la competencia.

Tono: amable y directo. Tuteo. Sin lenguaje de marketing.
```

Tres cosas para tener en cuenta al escribirlo:

**No repitas las reglas de seguridad.** Agents suma solas un bloque de reglas antes de tus instrucciones: lo que escribe el visitante y lo que devuelven las herramientas se tratan como datos; el agente nunca revela su configuración; no inventa precios, fechas, links ni funciones; responde en el idioma del visitante. Gastar líneas del brief en eso solo lo alarga.

**Usá los campos que ya existen.** Los temas a evitar tienen su propio campo (uno por línea, hasta 30) y el largo máximo de respuesta también (800 caracteres por defecto, entre 100 y 4.000). Lo que va en un campo se aplica siempre. Lo que va en el brief, el modelo lo interpreta.

**Nombrá las herramientas por lo que hacen.** "Creá un issue en Track" es más claro para el modelo que "registrá el problema". Y prendé solo las herramientas que el brief menciona: una herramienta prendida que el brief no explica es una herramienta que el agente usa a su criterio.

Si no querés arrancar en blanco, hay tres plantillas: soporte, SDR que agenda reuniones y calificador de leads. Cada una trae su brief y prende las herramientas que necesita.

## Parte 2: el conocimiento, escrito para la búsqueda

Esta es la parte que más rinde, y depende de cómo funciona la búsqueda.

Cuando el agente necesita información, llama a "Buscar conocimiento" con unas pocas palabras clave. Agents parte cada página en trozos de unos 900 caracteres, respetando las oraciones, y los ordena con BM25: una búsqueda léxica, por coincidencia de palabras. No hay embeddings. Al modelo le llegan los 5 trozos con más puntaje, y el título de cada página cuenta doble.

De ahí salen cinco reglas de escritura:

**1. Escribí con las palabras de tus clientes.** Si ellos dicen "dar de baja" y tu página dice "cancelación de la suscripción", la búsqueda puede no encontrarla. Abrí el inbox de Chat, copiá cómo pregunta la gente y usá esas palabras en el texto. Las tildes y las mayúsculas no importan; las palabras sí.

**2. Titulá como una pregunta.** El título cuenta doble. "¿Cómo cambio la tarjeta de pago?" le gana a "Facturación (general)".

**3. Un tema por página.** Una página de "Preguntas frecuentes" con cuarenta respuestas se parte en trozos que mezclan temas, y todos comparten el mismo título. Cuarenta páginas cortas funcionan mejor.

**4. Cada párrafo tiene que entenderse solo.** Como el agente recibe trozos sueltos, "Como dijimos arriba, eso se hace desde Ajustes" no le sirve. "El email de facturación se cambia en Ajustes, sección Pagos" sí.

**5. Poné los números con su contexto.** "Hasta 3 usuarios en el plan Básico" dentro de la misma oración. Si el número queda en un trozo y el nombre del plan en otro, el agente recibe medio dato.

### De dónde saca el conocimiento

En la pestaña Conocimiento elegís tres fuentes:

- **Páginas de Docs.** Por defecto, todas las páginas públicas, incluidas las que crees después. También podés sumar páginas privadas una por una, con un aviso: cualquiera que hable con el agente puede ver ese contenido. Si ya tenés una [wiki interna en Docs](/blog/wiki-interna-con-docs), separá lo que es para clientes.
- **Páginas web.** Hasta 20 URLs. Cada URL es una página: Agents descarga su texto (hasta 60.000 caracteres) y no recorre el resto del sitio. El texto no se actualiza solo; cuando cambies la página, tocá Actualizar.
- **Respuestas guardadas** de un widget de Chat. Las que tu equipo ya usa para contestar rápido.

## Parte 3: probalo con preguntas reales

Antes de conectar el agente al widget de Chat, juntá 20 preguntas reales de tu inbox. No las inventes: las inventadas siempre están bien escritas.

En el Playground, hacé cada pregunta como la haría un cliente. Las herramientas aparecen en línea, con lo que mandó y lo que le volvió. Para cada respuesta, anotá una de cuatro:

| Resultado | Qué arreglar |
|---|---|
| Respondió bien | Nada |
| Respondió mal con el trozo correcto | El brief: falta una regla o un ejemplo |
| "Buscar conocimiento" no trajo el trozo correcto | La página: palabras, título o tema mezclado |
| No había página sobre eso | Escribila, o sumala a las palabras que derivan |

La tercera fila es la más común y la más fácil de arreglar: mirá qué palabras usó el agente en la búsqueda (están en el registro) y fijate si aparecen en tu página.

Después de publicarlo, la pestaña Conversaciones guarda cada intercambio de todos los canales con su registro de herramientas, y cada respuesta se puede calificar con pulgar arriba o abajo y una nota. Repetí la prueba de las 20 preguntas cada vez que cambies el brief: un arreglo para una pregunta a veces rompe otra.

## Lo que todavía no hace

La búsqueda es léxica: no entiende sinónimos que no estén escritos. Las URLs no se recorren ni se actualizan solas. Y no hay un panel que te sugiera qué páginas escribir a partir de las conversaciones sin respuesta; esa lista la armás vos con la revisión semanal. Lo que sí tenés es todo a la vista: las instrucciones de seguridad están en el código abierto, el conocimiento vive en tus Docs y cada búsqueda queda registrada. Para decidir cuándo el agente tiene que soltar la conversación, seguí con [cuándo derivar a una persona](/blog/cuando-un-agente-tiene-que-derivar).
