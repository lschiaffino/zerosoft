---
title: "Listas estáticas, listas dinámicas y campos personalizados en el CRM"
description: "Cómo segmentar contactos en el CRM de zerosoft con listas estáticas, listas dinámicas, vistas guardadas y campos personalizados: para qué sirve cada una, sus límites y reglas para mantener los datos limpios."
date: "2026-09-20"
author: "zerosoft"
tags: ["crm", "segmentación", "guía"]
---

Todo CRM termina teniendo un cajón de sastre. Un campo que se llama "Notas 2". Un desplegable con las opciones "Sí", "si" y "S". Treinta listas llamadas "Webinar", "Webinar marzo", "webinar marzo FINAL". Ninguna fue una mala idea en su momento. Todas juntas hacen que segmentar sea más lento que exportar a una planilla, que es exactamente lo que la gente termina haciendo.

zerosoft CRM te da tres herramientas para cortar tus contactos: listas estáticas, listas dinámicas y vistas guardadas, más los campos personalizados para cortar por ellos. Se pisan un poco, y cada una tiene límites que conviene conocer. Acá va cuándo usar cuál.

## Las tres herramientas, un párrafo cada una

**Las listas estáticas** son un conjunto de contactos elegidos a mano. Agregás gente desde la página de la lista (buscar y agregar) o automáticamente con la acción de workflow "Agregar a lista". No cambian salvo que alguien, o un workflow, las cambie. Sirven para: asistentes a un evento, clientes beta, "la gente que conocimos en la feria".

**Las listas dinámicas** son un filtro guardado sobre contactos que se recalcula cada vez que la abrís. El filtro puede combinar una búsqueda de texto (nombre o email), etapa del ciclo de vida, estado del lead y origen. La página de listas muestra la cantidad de miembros en vivo; la lista en sí muestra hasta 500 miembros. Sirven para: "todos los SQL", "leads nuevos que vinieron por referidos", "todos los que están en mal momento".

**Las vistas guardadas** son una configuración de tabla guardada sobre contactos, empresas, deals o tareas: filtros rápidos, filtros avanzados y orden. El constructor de filtros avanzados combina reglas con AND y funciona sobre campos estándar y sobre campos personalizados. Sirven para: todo lo que depende de un campo personalizado, o que es sobre empresas y deals en vez de contactos.

## El límite que decide la mayoría de los casos

Acá va la parte honesta: **las listas dinámicas filtran solo por cuatro cosas**: búsqueda de texto, etapa del ciclo de vida, estado del lead y origen. No filtran por campos personalizados, dueño, empresa ni fecha de creación, y las listas son solo de contactos.

Así que la regla general es simple:

- El segmento depende del ciclo de vida, el estado del lead o el origen → **lista dinámica**.
- El segmento depende de un campo personalizado, un dueño, una fecha, o es sobre empresas o deals → **vista guardada**.
- El segmento es un grupo de personas concretas que ningún filtro describe → **lista estática**.

Otra cosa que las listas no hacen: no son listas de correo. zerosoft CRM no manda campañas de marketing ni secuencias. Una lista sirve para organizar, contar y disparar trabajo, no para mandar emails masivos.

## Campos personalizados: qué hay

Los campos personalizados viven en Configuración → Campos personalizados y se pueden agregar a **contactos, empresas y deals**. Cinco tipos:

- **Texto**: texto libre.
- **Número**: montos, cantidades, meses.
- **Fecha**: fechas de renovación, fin del trial, última auditoría.
- **Selección**: un conjunto fijo de opciones (hasta 100).
- **Booleano**: sí o no.

Cada campo tiene una **clave** y una **etiqueta**. La clave es lo que usan los datos, la API y los workflows: minúsculas, empieza con letra, solo letras, dígitos y guiones bajos, como `contract_months` o `renewal_date`. La etiqueta es lo que ve la gente, y la podés cambiar cuando quieras. Elegí la clave con cuidado: en la pantalla de configuración podés editar la etiqueta y las opciones de una selección, pero no la clave.

Dónde aparecen los campos personalizados:

- En la **ficha del registro**, en su propia sección.
- En los **filtros**: los campos de selección se vuelven filtros rápidos desplegables en las tablas de contactos y deals, y todo campo personalizado está disponible en el constructor de filtros avanzados, con operadores acordes a su tipo (contiene, =, >, antes de, entre, es / no es…).
- En los **workflows**: "Actualizar campo" puede escribir `custom.tu_clave`, y los emails y notificaciones pueden imprimir `{{contact.custom.tu_clave}}`, `{{deal.custom.tu_clave}}` y así.
- En la **API**, como el objeto `custom` de contactos, empresas y deals.
- En las **exportaciones**, dentro de la columna `custom`.

## Reglas para no hacer un desastre

### 1. Preferí selección antes que texto cuando la respuesta es una categoría

Un campo de texto llamado "Industria" va a juntar "SaaS", "saas", "Software" y "software (B2B)" en un mes. Una selección con seis opciones no puede. Si podés enumerar las respuestas, es una selección. El texto es para cosas realmente libres: una nota corta, un número de referencia.

### 2. Preferí un campo estándar antes que uno personalizado

Antes de crear un campo, fijate si ya existe. Etapa del ciclo de vida, estado del lead, origen, prioridad, monto y fecha de cierre son estándar y funcionan en todos lados: listas dinámicas, reportes, el tablero. Un "Temperatura del lead" personalizado que duplica el estado del lead te va a partir los datos en dos.

### 3. Nombrá las claves pensando en el futuro, no en hoy

`q3_webinar_attended` es un campo que vas a borrar en octubre. `webinar_attended_at` (una fecha) sirve para todos los webinars. Nombrá las claves según el concepto estable y poné la parte variable en el valor.

### 4. Cada campo necesita un dueño y un motivo

Si nadie puede decir qué reporte, filtro o decisión usa un campo, no lo crees. Revisá los campos personalizados una vez por trimestre. Borrar uno es solo para admins y lo saca de formularios y filtros, pero no limpia los valores guardados en los registros, que siguen viajando en las exportaciones. Borrar es ordenar, no eliminar los datos.

### 5. Dinámica antes que estática

Una lista estática queda congelada en el momento en que la creás. Un mes después está mal en las dos direcciones: falta gente que debería estar y sobra gente que no. Si un filtro puede describir el segmento, usá una lista dinámica o una vista guardada. Usá listas estáticas solo cuando la pertenencia es un hecho del pasado ("vino al evento de marzo") y no un estado ("es cliente").

### 6. Dejá que los workflows mantengan las listas estáticas

Cuando una lista estática sí tiene sentido, no la mantengas a mano. Ejemplo: "Clientes 2026" como lista estática, alimentada por un workflow con el disparador **Deal ganado** y la acción **Agregar a lista**. La acción agrega el primer contacto del deal. Es un registro que solo crece de quién se volvió cliente, sin un solo clic.

### 7. Una sola convención de nombres para las listas

Elegí un patrón y respetalo, por ejemplo `[Tipo] Descripción`: `[Evento] Feria Madrid 2026`, `[Segmento] SQL por referidos`, `[Ops] Leads sin tocar`. Cuando tengas 40 listas, vas a agradecer que se ordenen solas.

## Un ejemplo completo

Supongamos que tenés una agencia chica y querés encontrar "clientes cuyo contrato se renueva en los próximos 60 días".

1. Creá un campo personalizado en **empresas**: `renewal_date`, tipo Fecha.
2. Completalo para tus clientes (a mano, o una vez por API si lo tenés en una planilla).
3. En la tabla de empresas, abrí los filtros avanzados: **ciclo de vida es Cliente** Y **renewal_date entre** hoy y dentro de 60 días.
4. Guardalo como vista: "Renovaciones, próximos 60 días".

Eso es una vista guardada, no una lista, porque depende de un campo personalizado y vive en empresas. Ojo: las fechas de los filtros son absolutas, así que actualizá el rango cada vez que la uses.

La mejor configuración de CRM no es la que tiene más campos y listas. Es la que tiene un motivo para cada campo, una regla para cada lista, y donde cualquiera del equipo encuentra el segmento correcto en diez segundos.
