---
title: "Herejía técnica: SQLite es suficiente"
description: "La base de datos más desplegada del planeta corre en tu teléfono, tu navegador y, sí, en Link. Millones de filas sin drama, WAL mode y backups que son copiar un archivo."
date: "2026-06-12"
author: "Zerosoftware"
tags: ["sqlite", "self-host", "arquitectura"]
---

Decir en voz alta que tu app corre sobre SQLite provoca una reacción previsible: cara de "eso es una base de datos de juguete". Es al revés. SQLite es la base de datos más desplegada y más testeada del mundo: está en cada iPhone, cada Android, cada navegador, cada televisor. Miles de millones de instancias en producción. El "juguete" tiene más horas de vuelo que cualquier otra pieza de software de datos jamás escrita.

## Qué puede hacer SQLite hoy

- **WAL mode.** Con Write-Ahead Logging, las lecturas no bloquean la escritura y la escritura no bloquea las lecturas. Cientos de lectores concurrentes mientras se escribe.
- **Volumen.** Millones de filas son rutina. El límite teórico de una base SQLite son 281 TB. El analytics de un año entero de Link entra en unos pocos GB.
- **Velocidad.** Corre in-process, dentro de tu app: no hay red, no hay socket, no hay salto de latencia entre la query y los datos. Muchas consultas responden más rápido que contra un Postgres en otro contenedor.
- **Backups.** `cp link.db backup.db`. Fin del runbook. Y con Litestream, replicación continua a object storage por centavos.
- **Resistencia.** sqlite.org corre sobre SQLite. Su propia documentación dice que maneja sin drama sitios de hasta ~100.000 requests por día — y eso es conservador.

## Por qué Link usa SQLite

El workload de Link es el paraíso de SQLite: un redirect es un `SELECT` por clave primaria más un `INSERT` chico. Lectura intensiva, escritura liviana, un solo servidor. La base entera de un usuario heavy — cientos de miles de clicks — son decenas de megabytes.

Para el self-hoster, la diferencia es brutal: no hay nada que instalar. Sin Postgres que configurar, sin Redis que tuneear, sin docker-compose con seis servicios, sin volumen persistente que mapear. Descargás Link, lo corrés, listo. Un proceso, un archivo.

Y ese archivo lo es todo: tu base, tu backup y tu plan de salida. Si algún día te vas, te llevás `link.db` y tenés tus datos completos, legibles y portables. No hay dump propietario, no hay exportador con features pagas.

## Cuándo SÍ necesitás Postgres

La herejía tiene límites, y nombrarlos es parte de la honestidad:

- **Escritura concurrente alta.** SQLite tiene un solo escritor. Si tu app inserta miles de filas por segundo desde muchos procesos, necesitás una base en red.
- **Varios nodos que escriben.** Si escalás horizontal con múltiples servidores de aplicación, necesitás Postgres (o algo equivalente).
- **Features específicas.** Row-level security, replicación lógica, extensiones como PostGIS: el ecosistema Postgres no tiene rival.

Ahora bien: tu CRM, tu acortador de links, tu dashboard interno no están ni cerca de esos límites. Viven en un VPS de $5 con tráfico de sobra. Elegir Postgres "por las dudas" es pagar complejidad hoy por un problema que quizá nunca llegue. Y si llega, empezar con SQLite no fue un callejón sin salida: tu base es un archivo y exportarla es un script de una tarde.

Empezá simple. La escala que te imaginás probablemente no es la escala que tenés.
