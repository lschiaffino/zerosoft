---
title: "Self-hosting en 2026: un VPS de $5 y tres comandos"
description: "Contenedores, VPS baratos y apps pensadas para correr con SQLite hicieron que hostear tu propio software sea una tarea chica. Qué cambió y qué hay que mantener."
date: "2026-07-11"
author: "zerosoft"
tags: ["self-hosting", "open source", "tutorial"]
---

Durante años, la respuesta del SaaS al self-hosting fue "podés correrlo vos, pero quién quiere ese dolor". Servidores, bases de datos, certificados, backups y actualizaciones. Tenían razón. Hoy hostear una app bien hecha es bastante más simple.

## Qué cambió

1. **Los contenedores.** Docker empaqueta la app entera (código, runtime y configuración) en algo que se levanta con un comando.
2. **Los VPS.** Hetzner, DigitalOcean, Fly.io o Railway te dan un servidor en dos minutos por unos $5 al mes, con snapshots.
3. **Las apps.** Cada vez más software asume el self-host desde el diseño: una base embebida (SQLite), variables de entorno documentadas y ningún servicio externo obligatorio.

## zerosoft en tres comandos

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

No hay base de datos que instalar: SQLite se crea sola. Tampoco Redis ni colas. Es un proceso de Node y un archivo de datos; el backup es copiar ese archivo (bien hecho, como explicamos en [backups que funcionan](/blog/backups-que-funcionan)).

El login con Google son dos variables de entorno. El HTTPS, Caddy u otro proxy en diez líneas. La guía completa está en [self-hosting con Docker, paso a paso](/blog/self-hosting-con-docker-paso-a-paso).

## Qué hay que mantener

No es cero trabajo. En una app bien diseñada es:

- Actualizar el sistema operativo de vez en cuando.
- Verificar que el backup exista, o automatizarlo con un cron.
- Actualizar la app cuando salga algo que te interese.

## Si no querés hacerlo

Lo corremos nosotros en zerosoft Cloud: plan gratis y después pago por uso. Lo importante es que la opción de correrlo vos existe. Con esa salida disponible, quedarte en un proveedor es una elección.
