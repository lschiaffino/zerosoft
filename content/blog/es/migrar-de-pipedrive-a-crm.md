---
title: "Cómo migrar de Pipedrive al CRM de zerosoft"
description: "Guía para pasar personas, organizaciones, deals, pipelines, campos propios y actividades de Pipedrive al CRM con tu token de API, y qué revisar al terminar."
date: "2026-10-31"
author: "zerosoft"
tags: ["crm", "pipedrive", "migración", "guía"]
---

Si tu equipo vive en Pipedrive, lo que más pesa en una mudanza es el pipeline: los deals abiertos, en qué etapa está cada uno y la historia de llamadas y notas que explica por qué. El [CRM](/products/crm) de zerosoft trae todo eso directo desde la API de Pipedrive, con una vista previa antes de escribir nada. Acá va qué se importa campo por campo, qué no y los pasos exactos.

## Qué necesitás

Un solo dato: tu **token personal de API** de Pipedrive. Lo encontrás en Pipedrive abriendo tu avatar › Preferencias personales › API. Usá el de una cuenta admin: el token ve lo que ve esa persona, y con una cuenta admin vienen los registros de todo el equipo.

En zerosoft, el import lo corre alguien que administre el workspace. El token se guarda cifrado mientras corre y se borra cuando termina, falla o lo cancelás.

## Qué se importa

El importador lee cinco cosas, en este orden: organizaciones, personas, deals, notas y actividades. Antes lee los usuarios, los campos propios y los pipelines.

- **Organizaciones → empresas.** Nombre, sitio web (de ahí sale el dominio), industria, cantidad de empleados, ciudad y país de la dirección, y owner.
- **Personas → contactos.** Nombre y apellido, el email y el teléfono principales, cargo, owner y su organización, que queda como empresa primaria.
- **Pipelines y etapas.** Con su orden y la probabilidad de cada etapa. Si ya tenés un pipeline o una etapa con el mismo nombre, se reusa.
- **Deals.** Título, pipeline, etapa, monto, moneda, fecha de cierre, owner, motivo de pérdida, la persona y la organización vinculadas. Se traen abiertos, ganados y perdidos; los borrados no.
- **Notas.** Pasan al timeline del contacto, la empresa o el deal al que estaban atadas, con su fecha y autor. El HTML de Pipedrive se convierte a texto.
- **Actividades.** Llamadas, reuniones y emails entran con su tipo. Cualquier otro tipo (los propios que hayas creado, por ejemplo) entra como tarea. Vienen el asunto, la nota, el vencimiento, si está hecha y la duración.
- **Campos propios** de personas, organizaciones y deals. Cada uno se crea como campo personalizado con un tipo equivalente: número, moneda, fecha, selección, selección múltiple, teléfono o texto. Las opciones de los campos de selección viajan con sus etiquetas.
- **Owners.** Cada usuario de Pipedrive se cruza por email con alguien del workspace. A quienes no coinciden los asignás vos o los invitás desde la misma pantalla.

### Ganado y perdido

En Pipedrive, ganado o perdido es un estado del deal, no una etapa. En el CRM es una etapa. Por eso cada pipeline importado suma dos etapas al final, **Won** y **Lost**, y los deals cerrados caen ahí. La fecha de cierre sale de cuándo se ganó o se perdió; si está abierto, de la fecha esperada de cierre.

## Qué no se importa

Leído del código del importador, esto se queda en Pipedrive:

- **Archivos adjuntos** de deals, personas u organizaciones.
- **Leads** de la bandeja de leads y **productos** de los deals: el importador no lee esas partes de la API.
- **Emails y teléfonos secundarios.** Solo viaja el principal de cada persona.
- **Campos de sistema** que no están en la lista de arriba, como la etiqueta de la persona o la dirección completa (solo ciudad y país).
- **La descripción del deal** y el resultado de las llamadas.

Si te hace falta algo de esto, exportalo de Pipedrive antes de cerrar la cuenta.

## Paso a paso

1. **Abrí el importador.** En zerosoft andá a Ajustes › Importar y elegí **HubSpot o Pipedrive al CRM**. También está en el CRM, en Ajustes › Importar y exportar › **Importar desde otro CRM**.
2. **Conectá.** En la tarjeta **Importar desde Pipedrive**, tocá **Conectar Pipedrive**, pegá el token en **Token de API** y tocá **Conectar y ver vista previa**.
3. **Revisá la vista previa.** Todavía no se importó nada. Vas a ver una muestra de empresas y contactos, los campos propios (cada uno con "usar la existente" o "crear"), los pipelines con sus etapas y la tabla de owners. Pipedrive no da totales por adelantado, así que donde iría la cantidad dice "Todo".
4. **Elegí qué importar.** En **Qué importar** marcás Empresas, Contactos, Deals y Actividades. Las actividades incluyen las notas.
5. **Asigná owners.** Los que coinciden por email ya aparecen como "coincide por email". Para el resto elegí a alguien o dejá el owner por defecto. Si invitás a esa persona después y entra con el mismo email, pasan a ser suyos los registros que nadie reasignó.
6. **Tocá Arrancar import.** El import corre por tramos en segundo plano. Podés cerrar la pestaña: la pantalla lo retoma al volver y el avance cuenta lo procesado.

## Qué revisar al terminar

- **El resumen por objeto.** Al final ves procesados, creados, actualizados, salteados y con error. Si hay errores, la lista de avisos dice cuáles.
- **Los duplicados que no se crearon.** Un contacto con el mismo email o una empresa con el mismo dominio que ya existían no se duplican: se completan sus campos vacíos.
- **Las etapas Won y Lost.** Si en tu proceso usás otros nombres, renombralas en los ajustes del pipeline.
- **Tus automatizaciones.** Los registros importados se escriben directo y no disparan workflows ni webhooks. Si un workflow tenía que correr para los contactos existentes, correlo a mano.
- **Algunos deals grandes.** Compará monto, etapa y timeline con Pipedrive.

## Correrlo de nuevo

Cada registro guarda su id de Pipedrive. Si volvés a importar, se actualiza en vez de duplicarse. Si alguien editó un registro en zerosoft después del import, no se pisa: solo se completan los campos vacíos, salvo que marques **Reemplazar con lo de Pipedrive**. Eso te deja hacer la mudanza en dos tiempos: un import ahora, el equipo prueba, y otro el día que apagan Pipedrive para traer lo último.

Si preferís archivos, el import por CSV del CRM tiene un preset **Export de Pipedrive** que mapea las columnas solo. Para el mapeo y los enums vale lo mismo que en [la guía de CSV de HubSpot](/blog/migrar-contactos-de-hubspot-por-csv).

## Lo que todavía falta

Nuestra tabla de paridad compara el CRM con HubSpot, no con Pipedrive, así que acá van solo los huecos que publicamos ahí:

- **Notetaker.** Las llamadas y reuniones del timeline tienen resumen con IA a partir de sus notas o una transcripción adjunta. No hay un bot que entre a la llamada y la grabe.
- **App nativa.** Es una app instalable (PWA) en iOS y Android que funciona sin conexión en las vistas ya abiertas. No está en App Store ni Google Play.
- **Directorio de apps.** Slack, Zoom, Stripe, Zapier y Make vienen integrados, más webhooks y API REST. No hay marketplace de terceros.

## Cuánto cuesta

Self-host: $0, con el código bajo AGPLv3 y todas las funciones. zerosoft Cloud tiene un plan gratis para empezar y después cobra por uso (emails, almacenamiento). Los asientos no se cobran: sumar diez vendedores no cambia la factura. El detalle de cómo se compara con HubSpot está en [zerosoft vs HubSpot](/compare/zerosoft-vs-hubspot).

Una vez adentro, una buena primera tarea es una pasada de [higiene del pipeline](/blog/higiene-del-pipeline): los deals que llegan de un CRM viejo suelen traer etapas que nadie toca hace meses.
