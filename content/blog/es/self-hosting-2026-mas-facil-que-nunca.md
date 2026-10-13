---
title: "Self-hosting en 2026: más fácil que nunca (y no es solo para nerds)"
description: "Un VPS de $5, tres comandos y tu propio software corriendo. La brecha entre 'instalar' y 'suscribirse' nunca fue tan chica."
date: "2026-07-11"
author: "Zerosoftware"
tags: ["self-hosting", "open source", "tutorial"]
---

Durante años, la respuesta del SaaS al self-hosting fue siempre la misma: "claro que podés correrlo vos, pero quién quiere ese dolor". Servidores que configurar, bases de datos que mantener, certificados, backups, actualizaciones. Era verdad: era un dolor.

Esa verdad quedó vieja. En 2026, self-hostear una app bien hecha es más fácil que configurar tu impresora.

## Lo que cambió

Tres cosas hicieron colapsar la dificultad:

1. **Los contenedores ganaron.** Docker y sus sucesores empaquetan una app entera —código, runtime, configuración— en algo que se levanta con un comando. Ya no "instalás" software: lo *corrés*.
2. **Los VPS se abarataron y simplificaron.** Hetzner, DigitalOcean, Fly.io, Railway: un servidor en dos minutos, $5 al mes, con snapshots automáticos y redes privadas.
3. **El software se diseñó para esto.** Las buenas apps modernas asumen self-host como ciudadano de primera clase: una sola base de datos embebida (SQLite), variables de entorno documentadas, cero servicios externos obligatorios.

## La prueba: Link en tres comandos

Nuestro acortador de links se corre así:

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

Sin base de datos que instalar (SQLite se crea sola). Sin Redis, sin colas, sin workers. Un proceso de Node y un archivo de datos. El backup es copiar ese archivo.

¿Login? Google OAuth con dos variables de entorno. ¿HTTPS? Caddy o tu proxy favorito en diez líneas. ¿Actualizaciones? `git pull && npm run build`.

## Lo que realmente hay que mantener

Seamos honestos: self-hostear no es *cero* trabajo. Es, en una app bien diseñada:

- Un `apt update` de vez en cuando.
- Mirar que el backup exista (o automatizarlo: es un cron de una línea).
- Actualizar la app cuando salga algo que te interese.

Es menos tiempo del que pasás al año peleando con cambios de planes, aumentos de precio y features que tu vendor movió de tier.

## Y si no querés ni eso

Para eso está la otra opción: lo corremos nosotros y pagás la nube al costo. Pero el punto importante no es que elijas self-host. Es que *podés*. Que la puerta esté abierta cambia la relación entera: ya no estás atrapado, estás eligiendo.

Eso es el nuevo mundo: no que todos administren servidores, sino que nadie sea rehén de un login.
