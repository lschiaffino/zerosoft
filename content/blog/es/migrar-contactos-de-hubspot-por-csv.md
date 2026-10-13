---
title: "Cómo sacar tus contactos de HubSpot con un CSV"
description: "Guía paso a paso para exportar contactos y empresas de HubSpot e importarlos en Zerosoft CRM: mapeo de columnas, dedupe por email y dominio, y qué cosas no viajan."
date: "2026-07-24"
author: "Zerosoftware"
tags: ["crm", "hubspot", "migración"]
---

Cambiarte de CRM suena a proyecto de un trimestre. Para la mayoría de los equipos chicos es una tarde: dos CSV, una pantalla de mapeo y un café. El truco es saber exactamente qué hace el importador con cada fila antes de apretar el botón, así no terminás con 400 duplicados y una columna de lifecycle llena de vacíos.

Esta es la versión honesta. Qué se mueve, qué no, y el orden que te ahorra limpiar después.

## Qué podés importar (y qué no)

El importador de Zerosoft CRM (`/app/crm/settings` → Import / Export) maneja dos entidades:

- **Contactos**: nombre, apellido, email, teléfono, cargo, sitio web, ciudad, país, lifecycle stage, lead status y origen.
- **Empresas**: nombre, dominio, industria, empleados, teléfono, sitio web, ciudad, país y lifecycle stage.

Lo que hoy **no** importa:

- **Deals.** Todavía no hay importador de deals. Si tenés un pipeline vivo, o recreás a mano los deals abiertos (para un equipo chico suele ser lo más rápido) o lo scripteás contra la API pública: `POST /api/v1/crm/deals` existe y recibe pipeline, etapa, monto, fecha de cierre y contactos.
- **Actividades.** Notas, llamadas, emails y reuniones registradas en HubSpot se quedan en HubSpot. Exportalas a un archivo como referencia; no van a aparecer en el timeline.
- **Campos personalizados.** El mapeo del CSV solo apunta a los campos estándar de arriba. Los valores custom se pueden cargar por API (`custom` en contactos, empresas y deals), no desde la pantalla del CSV.
- **Owners.** No hay columna de owner en el import. Asignalos después, desde cada registro o por API.

Si algo de esto te mata el plan, mejor saberlo ahora que a mitad de camino.

## Paso 1: exportar de HubSpot

En HubSpot, exportá contactos y empresas como dos CSV separados desde la vista de índice de cada objeto. Dos consejos:

- **Exportá solo lo que vas a mapear.** Los exports de HubSpot pueden traer docenas de columnas. Las que el importador no reconoce se ignoran por defecto, pero una pantalla de mapeo con 60 columnas es la receta del error. Elegí las propiedades de la vista antes de exportar.
- **Guardá los archivos originales.** Ponelos en un lugar seguro. Son tu backup de todo lo que no viaja, incluidas propiedades custom e IDs de registro.

## Paso 2: primero las empresas

El orden importa. Cuando se crea un contacto sin empresa explícita, Zerosoft mira el dominio de su email y lo vincula con la empresa que tenga exactamente ese dominio (los emails personales tipo Gmail se saltean). Si `ana@acme.com` llega cuando ya existe una empresa con dominio `acme.com`, Ana queda vinculada sola.

Eso solo funciona si las empresas ya están. Empresas primero, contactos después.

Para que el match pegue, el dominio de la empresa tiene que ser el dominio pelado: `acme.com`, no `https://www.acme.com/`. Limpiá esa columna antes de importar.

## Paso 3: la pantalla de mapeo

El importador tiene tres pasos: subir (o pegar) el CSV, mapear columnas, ver el resultado. En el mapeo, cada columna de tu archivo muestra su encabezado, un valor de ejemplo de la primera fila y un dropdown con el campo destino. El importador adivina según el nombre del encabezado, ignorando mayúsculas, espacios y signos, y conoce algunos alias en inglés y español (`nombre`, `correo`, `empresa`, `cargo`…).

Con los encabezados típicos de HubSpot, algunos se mapean solos y otros piden un clic:

- Suelen mapearse solos: `First Name`, `Last Name`, `Email`, `Job Title`, `City`, `Lifecycle Stage`, `Lead Status`, `Industry`, `Company name`.
- Suelen pedir mapeo manual: `Phone Number`, `Country/Region`, `Website URL`, `Company Domain Name`, `Number of Employees`.

Lo que dejes en "— ignorar —" se descarta. `Record ID` y compañía pueden quedar ignorados.

### Los valores de enum: la trampa silenciosa

Lifecycle stage, lead status y origen son listas fijas en Zerosoft:

```
lifecycle:   subscriber, lead, mql, sql, opportunity, customer, evangelist
lead status: new, open, in_progress, open_deal, unqualified, connected, bad_timing
source:      organic, referral, ads, social, email, event, other
```

El importador los acepta sin importar mayúsculas, así que `Lead` o `Customer` andan. Pero un valor que no coincide exacto queda **vacío en silencio**, no rechazado. Si tu export dice `Marketing Qualified Lead` o `In Progress`, hacé buscar-y-reemplazar a `mql` o `in_progress` en el CSV antes. Si no, el contacto entra bien y el campo queda en blanco, cosa que vas a descubrir tres semanas después en un reporte.

## Paso 4: elegí el modo de dedupe

Antes de correrlo, elegís qué pasa cuando un registro ya existe:

- **Saltearlo**: el registro existente no se toca; la fila cuenta como salteada.
- **Actualizarlo**: el registro existente toma los valores del archivo.

Las claves de dedupe son simples y conviene memorizarlas:

- **Contactos**: por email, sin distinguir mayúsculas. `Ana@Acme.com` y `ana@acme.com` son la misma persona.
- **Empresas**: por dominio, sin distinguir mayúsculas.

Y los casos borde:

- Un contacto **sin email** siempre se crea. No hay clave para comparar, así que si reimportás el mismo archivo, esos contactos sin email se duplican.
- Una empresa **sin dominio** siempre se crea, por lo mismo. Una fila de empresa sin nombre ni dominio se rechaza.
- Una fila con **email inválido** no se importa y aparece en la lista de errores con su número de fila.
- En modo actualizar, **las celdas vacías no pisan** nada. Solo viajan los valores no vacíos, así que un archivo incompleto no te borra datos buenos.

Cada import corre en una sola transacción y muestra un resumen: total, creados, actualizados, salteados y errores.

## Límites que conviene saber

- Hasta **5.000 filas por import**. ¿Archivo más grande? Partilo. Mismo mapeo, corrés de nuevo.
- Hasta **20 imports por hora** por usuario.

Si tenés 40.000 contactos, son ocho archivos y unos minutos, no un ticket de soporte.

## Paso 5: revisá y limpiá

Después de importar:

1. **Fusioná los duplicados que queden.** La página de cada contacto tiene un panel de duplicados que lista otros contactos con el mismo email y te deja fusionarlos. El que descartás le pasa sus deals, actividades, emails y membresías de listas estáticas al que conservás.
2. **Revisá los enums.** Filtrá contactos por lifecycle stage. Si un montón quedó sin valor, es la trampa del Paso 3.
3. **Pausá automatizaciones en imports grandes.** Los contactos importados se crean como cualquier otro, así que un workflow disparado por "Contacto creado" puede reaccionar a ellos. Si alguno manda emails, apagalo antes de importar 5.000 filas.

## Hacerlo por script

Si te llevás bien con un poco de código, la API pública (`/api/v1/crm/contacts`, `/companies`, `/deals`, documentada en [/docs](/docs)) te deja mover lo que el CSV no: campos custom, owners, deals. Te autenticás con una key personal en `Authorization: Bearer zs_…` y te mantenés debajo de 100 requests por minuto.

La mayoría de los equipos no lo necesita. Dos CSV, empresas primero, limpiá los enums, elegí el modo de dedupe. Y después lo importante: [tus datos se pueden ir igual de fácil](/blog/exportar-tus-datos-deberia-ser-un-derecho). Los admins pueden exportar contactos, empresas, deals y actividades en CSV o JSON cuando quieran.
