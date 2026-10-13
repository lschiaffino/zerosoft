---
title: "SQLite alcanza para la mayoría de las apps de negocio"
description: "SQLite corre en cada teléfono y cada navegador, y también en zerosoft. Qué permite el modo WAL, cuánto aguanta, cómo se hace backup y cuándo conviene pasar a Postgres."
date: "2026-06-12"
author: "zerosoft"
tags: ["sqlite", "self-host", "arquitectura"]
---

Cuando contamos que zerosoft corre sobre SQLite, la reacción típica es "esa es una base de juguete". SQLite es la base de datos más desplegada del mundo: está en cada iPhone, cada Android y cada navegador, con miles de millones de instancias en producción. Este post explica qué puede hacer hoy y cuándo no alcanza.

## Qué puede hacer SQLite hoy

- **WAL mode.** Con Write-Ahead Logging, las lecturas no bloquean la escritura y la escritura no bloquea las lecturas. Cientos de lectores concurrentes mientras se escribe.
- **Volumen.** Millones de filas son rutina. El límite teórico de una base SQLite son 281 TB. El analytics de un año entero de Link entra en unos pocos GB.
- **Velocidad.** Corre dentro del proceso de tu app, sin red entre la consulta y los datos. Muchas consultas responden más rápido que contra un Postgres en otro contenedor.
- **Backups.** Una copia consistente con `.backup` o `VACUUM INTO` (ver [backups que funcionan](/blog/backups-que-funcionan)). Con Litestream, replicación continua a object storage por centavos.
- **Tráfico.** sqlite.org corre sobre SQLite. Su documentación dice que sirve sitios de hasta unos 100.000 pedidos por día, y aclara que es una cifra conservadora.

## Por qué Link usa SQLite

El workload de Link es el paraíso de SQLite: un redirect es un `SELECT` por clave primaria más un `INSERT` chico. Lectura intensiva, escritura liviana, un solo servidor. La base entera de un usuario heavy, cientos de miles de clicks, son decenas de megabytes.

Para quien hostea, la diferencia es grande: no hay nada que instalar. No hay un Postgres que configurar ni un Redis que ajustar, y el docker-compose tiene un solo servicio. Descargás zerosoft y lo corrés. Un proceso, un archivo.

Y ese archivo lo es todo: tu base, tu backup y tu plan de salida. Si algún día te vas, te llevás ese archivo con todos tus datos, legibles con cualquier cliente de SQLite.

## Cuándo SÍ necesitás Postgres

SQLite tiene límites:

- **Escritura concurrente alta.** SQLite tiene un solo escritor. Si tu app inserta miles de filas por segundo desde muchos procesos, necesitás una base en red.
- **Varios nodos que escriben.** Si escalás horizontal con múltiples servidores de aplicación, necesitás Postgres (o algo equivalente).
- **Features específicas.** Row-level security, replicación lógica, extensiones como PostGIS: el ecosistema Postgres no tiene rival.

Tu CRM, tu acortador de links, tu dashboard interno no están ni cerca de esos límites. Viven en un VPS de $5 con tráfico de sobra. Elegir Postgres "por las dudas" es pagar complejidad hoy por un problema que quizá nunca llegue.

Empezá simple. Si la escala llega, tu base es un archivo y exportarla es un script de una tarde. Y si necesitás varias instancias, zerosoft también corre sobre Turso, que habla el mismo SQL ([un código, dos bases](/blog/un-codigo-sqlite-local-o-turso)).
