---
title: "De un directorio web a empresas en tu CRM: lista de prospectos con un robot"
description: "Cómo recorrer un directorio público con paginación, quedarte solo con las filas nuevas y cargarlas como empresas en el CRM sin duplicados, usando Robots de zerosoft. Pasos, configuración y límites reales."
date: "2026-11-03"
author: "zerosoft"
tags: ["robots", "crm", "browse-ai"]
---

Browse AI ofrece un robot ya armado para [extraer datos de un lugar de Google Maps](https://browse.ai/t/extract-details-info-place-google-maps), y aclara que teléfono y sitio web solo se capturan cuando el negocio los publicó. Ese detalle importa más que cualquier plantilla: una lista de prospectos es tan buena como los campos que el sitio realmente muestra.

Este post resuelve el mismo problema con Robots, la automatización de navegador de zerosoft. Tomamos un directorio público (una cámara de comercio, un listado de proveedores, un catálogo de un evento), lo recorremos página por página y dejamos las empresas en el CRM, una sola vez cada una.

## Antes de empezar: qué sí y qué no

Elegí directorios que permitan leerlos con una herramienta automática. Revisá los términos del sitio y su archivo robots.txt antes de programar nada, y evitá los sitios que prohíben la extracción. Browse AI lo dice en sus propias páginas: la legalidad depende de la jurisdicción y del uso, y conviene consultarlo con alguien que sepa.

Una regla práctica para el CRM: cargá empresas, no personas. Los datos de una persona (email personal, teléfono) tienen reglas de consentimiento que una empresa publicada en un directorio comercial no suele tener. En Robots el destino CRM puede crear empresas por dominio, y esa es la ruta que usamos acá.

## Paso 1: crear el robot y leer la lista

Creá un robot nuevo desde Plantillas. Para este caso sirve "Lista y cada página de detalle", que ya trae la estructura: abrir la URL, extraer una lista y recorrerla. Reemplazá la URL por la del directorio.

En el paso Extraer lista:

1. **Selector de la tarjeta.** El bloque que se repite por cada empresa, por ejemplo `li.empresa`.
2. **Campos.** Un nombre de columna por dato, con su selector relativo a la tarjeta: `nombre`, `sitio` (atributo `href` del link), `ciudad`, `rubro`, `telefono`. Hasta 20 campos por fila.
3. **Paginación.** Elegí el modo que usa el directorio: botón Siguiente, botón Cargar más o scroll infinito. Fijá un máximo de páginas. Robots recorre hasta 20 páginas por paso y junta hasta 1.000 filas entre todas.

Si el sitio muestra el teléfono solo en la página de la empresa, el paso Recorrer lista abre cada link y lee ahí los campos que faltan. Activá "Si un elemento falla, registrar una advertencia y pasar al siguiente", así una ficha rota no frena las otras.

Corré el robot una vez a mano. En la pestaña Corridas ves las filas que salieron; si falta una columna, el problema casi siempre es un selector demasiado específico.

## Paso 2: elegir la clave de la tabla

Abrí la pestaña Datos. Robots guarda una tabla acumulada entre corridas y marca cada fila como nueva, cambiada o "ya no está". Para que eso funcione necesita una clave única: indicá `sitio`. Sin clave, la fila entera cuenta como clave, y un cambio de teléfono se vería como una empresa nueva más una empresa que desapareció.

La tabla guarda hasta 10.000 filas por robot y podés descargarla como CSV cuando quieras.

## Paso 3: mandar las empresas al CRM

En Integraciones, agregá un destino de tipo CRM y elegí Registros: Empresas (por dominio o nombre). Después mapeá las columnas con los campos del CRM: nombre, dominio, sitio web, teléfono, industria, ciudad y país.

Dos decisiones que evitan problemas:

- **Dominio.** Mapeá `sitio` a Dominio o a Sitio web. El destino normaliza la URL a un dominio en minúsculas y busca una empresa existente con ese dominio. Si no hay dominio, busca por nombre.
- **Si el registro ya existe.** El valor por defecto es "Solo completar los campos vacíos": nunca pisa lo que tu equipo escribió a mano. Elegí "Dejarlo como está" si el robot solo debe aportar altas, o "Pisar con los datos del robot" únicamente si el directorio es tu fuente de verdad.

El destino se ejecuta después de cada corrida exitosa y envía las filas nuevas y cambiadas, no la tabla completa. Las filas sin nombre ni dominio se saltean y el resultado de la corrida informa cuántas se crearon, actualizaron y saltearon.

## Paso 4: programarlo y enterarte de lo que cambia

En Horario, una corrida semanal alcanza para un directorio. El intervalo mínimo que acepta Robots es de 5 minutos, pero un listado de empresas no cambia tan seguido, y cuanto menos pidas, más tranquilo queda el sitio de origen.

En Integraciones activá también el email de cambios: te llega con las filas nuevas y las que ya no están. Si el robot falla varias veces seguidas (por ejemplo, porque el directorio se rediseñó), el horario se pausa solo (por defecto después de 3 fallas seguidas, configurable) y no sigue golpeando una página rota. La opción "Reaprender selectores solo", que viene apagada, hace que Robots intente reencontrar el elemento por su huella de la última corrida buena y guarde el selector nuevo si la corrida termina bien.

## Paso 5: priorizar con una columna de IA

Una lista de 400 empresas no se llama completa. En Datos podés agregar una columna con IA que completa cada fila con una instrucción corta, por ejemplo "¿Es una empresa de menos de 50 personas según su descripción? sí o no". Cada columna procesa hasta 100 filas por corrida y las filas que no cambiaron conservan su valor. La IA se cobra por tokens en la nube.

Tratá esa columna como una pista y no como un dato: revisá una muestra antes de usarla para filtrar.

## Lo que todavía no hace

- No resuelve captchas. Si el directorio los pone, el robot no avanza.
- El destino CRM crea contactos solo con email. Un directorio que no publica emails da empresas, no contactos, y eso es lo correcto para este flujo.
- No enriquece con emails de terceros ni compra bases. Lo que entra al CRM es lo que el sitio mostró.

## Qué cambia frente a un plan de créditos

Con un servicio de créditos, cada fila extraída consume cupo, y recorrer 20 páginas todas las semanas se nota en la factura. En zerosoft el core es AGPL: en tu servidor el robot corre en tu Chromium y la tabla vive en tu base. En zerosoft Cloud pagás el uso al costo por tres, con los dos números a la vista.

El resultado práctico: un robot, una tabla con historial y empresas en el CRM que ya tenían ficha antes de que tu equipo abra el directorio. Después de la primera corrida, tu trabajo es revisar las filas nuevas de cada semana, no volver a armar la lista.
