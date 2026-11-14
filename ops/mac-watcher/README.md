# Watcher de la Mac mini

Vigila lo que la web no puede ver (Railway: Postgres de Evolution, su disco y el servicio Evolution), aplica los arreglos conocidos y, si un incidente sigue abierto, despierta a Claude Code en la Mac para que lo resuelva.

Corre cada minuto con launchd (`ai.zerosoft.watcher`).

## Qué hace en cada vuelta

1. Lee el estado de Railway y lo informa a `POST /api/status/report`:
   - `evolution-db`: si Postgres está en marcha.
   - `evolution-db-disk`: uso del volumen. Pasa a degradado desde el 85 % y a caído desde el 97 %.
2. Aplica los runbooks, con 15 minutos como mínimo entre intentos sobre el mismo servicio:
   - Postgres caído con disco por debajo del 95 %: lo reinicia.
   - Evolution caído: lo reinicia.
   - Con el disco lleno no reinicia nada, porque no serviría. Ese caso pasa al paso 3.
3. Revisa los incidentes abiertos (`GET /api/status/incidents?state=open`). Si alguno lleva más de 3 minutos abierto, lanza `claude -p` con [incident-prompt.md](incident-prompt.md) y los datos del incidente:
   - Como máximo una sesión por incidente por hora, y cada una dura 30 minutos o menos.
   - Lo que responde Claude queda como nota en el incidente.

## Instalar

```sh
ops/mac-watcher/install.sh <railway-project-id>
```

Después, completá `STATUS_AGENT_TOKEN` en `~/.zerosoft-watcher/env`. El archivo tiene permisos 600 y debe tener el mismo valor que en Vercel. No lo pegues en ningún chat.

## Dónde mirar

| Qué | Dónde |
| --- | --- |
| Log del watcher | `~/.zerosoft-watcher/watcher.log` |
| Cada sesión de Claude | `~/.zerosoft-watcher/claude-<incidente>-<fecha>.log` |
| Marcas de último intento | `~/.zerosoft-watcher/state/` |

Para apagarlo:

```sh
launchctl bootout gui/$(id -u)/ai.zerosoft.watcher
```
