# Calls: el bot de grabación (zerosoft Notetaker)

Calls graba las reuniones de ventas con un bot propio que entra a la
videollamada como un participante más ("zerosoft Notetaker"), graba audio y
video y se va cuando la reunión termina. El bot vive en `services/calls-bot/`
(Node, Playwright con Chromium, Xvfb, PulseAudio y ffmpeg) y corre como un
servicio aparte (Docker, en Railway). La app (Next.js en Vercel) le pide que
entre a una reunión y recibe la grabación por partes.

Hoy entra a Google Meet. Zoom y Teams quedan para después: el bot tiene una
interfaz por plataforma (`platforms/<name>.js`) y la app ya manda `platform`.

## Variables

App (Vercel):

| Variable | Qué es |
| --- | --- |
| `CALLS_BOT_URL` | URL base del bot, p. ej. `https://calls-bot.up.railway.app` |
| `CALLS_BOT_SECRET` | Secreto compartido para firmar los pedidos app → bot (32+ caracteres) |
| `CALLS_BLOB_READ_WRITE_TOKEN` | Opcional: store privado de Vercel Blob para las grabaciones. Sin él, se cifran (AES-256-GCM) en el store de la suite (`lib/private-files.ts`) |
| `CALLS_FILES_KEY` | Opcional: clave propia del cifrado de grabaciones |
| `CALLS_BOT_FAKE=1` | Solo tests: no llama al bot, simula una grabación corta dentro de la app |

Bot (Railway):

| Variable | Qué es |
| --- | --- |
| `CALLS_BOT_SECRET` | El mismo secreto de la app |
| `CALLS_ALLOWED_CALLBACK_ORIGINS` | Orígenes a los que el bot puede devolver la grabación, separados por coma (p. ej. `https://zerosoft.ai`). Cualquier otro se rechaza |
| `CALLS_BOT_MAX_JOBS` | Reuniones a la vez (default 2) |
| `CALLS_BOT_FAKE_MEET=1` | Solo pruebas: sirve una reunión falsa en `/fake-meet/<código>` y acepta su URL |
| `PORT` | Puerto HTTP (Railway lo pone) |

## App → bot

Todos los pedidos van firmados:

```
x-zs-timestamp: <segundos unix>
x-zs-signature: sha256=<hex de HMAC-SHA256(CALLS_BOT_SECRET, "<timestamp>.<MÉTODO> <path>.<cuerpo crudo>")>
```

El bot rechaza (401) una firma inválida o un timestamp a más de 5 minutos.
Para GET y DELETE el cuerpo es la cadena vacía. `<path>` es el path del pedido sin query (`/v1/jobs`), y `<MÉTODO>` en mayúsculas: una firma capturada no sirve para otro método ni para otro trabajo.

### `POST /v1/jobs`

```json
{
  "jobId": "c_7f3a...",
  "platform": "meet",
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "botName": "zerosoft Notetaker",
  "consentMessage": "Hi! I'm zerosoft Notetaker. This call is being recorded and transcribed for ...",
  "callbackUrl": "https://zerosoft.ai/api/calls/bot",
  "callbackToken": "<token al azar de este trabajo>",
  "maxDurationSec": 10800,
  "lobbyTimeoutSec": 600,
  "aloneTimeoutSec": 120
}
```

- `202 { "accepted": true }`: lo toma. Repetir el mismo `jobId` es idempotente
  (si ya está corriendo o terminó, vuelve 202 sin duplicar).
- `400 { "error": "invalid_input" | "unsupported_platform" | "invalid_meeting_url" | "callback_not_allowed" }`.
- `503 { "error": "at_capacity" }`: la app reintenta en el próximo minuto.

`meetingUrl` debe ser `https://meet.google.com/<xxx-xxxx-xxx>` (con query
opcional). `callbackUrl` debe empezar con uno de
`CALLS_ALLOWED_CALLBACK_ORIGINS`.

### `DELETE /v1/jobs/:jobId`

Sale de la reunión ya (deja de grabar y sube lo que tiene). `200 { "ok": true }`
o `404`.

### `GET /v1/jobs/:jobId`

`200 { "jobId", "state", "startedAt", "error" }` (firmado, para diagnóstico).

### `GET /v1/health`

Sin firma: `200 { "ok": true, "version": "1", "activeJobs": 0, "maxJobs": 2 }`.
No dice nada de los trabajos.

## Bot → app

Todos con `authorization: Bearer <callbackToken>`. La app guarda solo el hash
del token y lo invalida al terminar el trabajo.

### Estados: `POST {callbackUrl}/jobs/{jobId}/events`

```json
{ "type": "joining", "at": "2026-11-08T15:00:03.120Z" }
```

`type`:

- `joining`: abrió la página y está entrando.
- `waiting_room`: pidió entrar ("Ask to join") y espera que lo admitan.
- `in_call`: está adentro. Manda el mensaje de consentimiento en el chat.
- `recording`: empezó a grabar. `at` es el cero de los tiempos (`startMs`).
- `left`: salió. `detail.reason`: `meeting_ended` | `alone` | `max_duration` | `stopped` | `removed`.
- `failed`: no pudo. `detail.reason`: `lobby_timeout` | `denied` | `invalid_meeting` | `join_error` | `record_error` | `upload_error` | `consent_not_sent` (no pudo dejar el aviso de grabación en el chat: no graba).
- `participants`: cambió la lista de participantes (`participants: [{ "name": "Ana Pérez" }]`). También puede venir en cualquier otro evento.

Si la app responde 401, 403, 404 o 409 a un callback (la llamada se borró, se detuvo o el trabajo terminó), el bot sale de la reunión enseguida y borra lo grabado. El `callbackToken` es el mismo en cada reintento de despacho de una llamada.

### Partes: `PUT {callbackUrl}/jobs/{jobId}/parts/{kind}/{n}`

Cuerpo crudo, hasta 4 MB (4 194 304 bytes) por parte, `n` desde 0.

- `kind=video`: el archivo de video (MP4 H.264 + AAC, `+faststart`) cortado en
  partes de 4 MB exactos (la última, menos). Se suben al terminar.
- `kind=audio`: segmentos de audio para transcribir, cada uno un archivo
  completo y decodificable por sí solo (Ogg/Opus mono 16 kHz, ~24 kbps, de
  10 minutos como máximo). Header `x-segment-start-ms: <ms desde recording>`.
  Pueden subirse mientras la reunión sigue.

`content-type`: el MIME del archivo (`video/mp4`, `audio/ogg`). Respuesta
`200 { "ok": true }`. Un 4xx no se reintenta; 5xx o error de red, hasta 5
reintentos con espera creciente.

### Fin: `POST {callbackUrl}/jobs/{jobId}/complete`

```json
{
  "endReason": "meeting_ended",
  "durationMs": 1834000,
  "video": { "parts": 23, "bytes": 92800311, "mime": "video/mp4" },
  "audio": { "segments": 4, "mime": "audio/ogg" },
  "speakers": [{ "name": "Ana Pérez", "startMs": 1200, "endMs": 5400 }],
  "captions": [{ "speaker": "Ana Pérez", "text": "Hola, ¿me escuchan?", "startMs": 1200 }],
  "participants": [{ "name": "Ana Pérez" }, { "name": "Lautaro" }]
}
```

- `speakers`: línea de tiempo de quién habla, tomada del indicador de hablante
  activo y de los subtítulos de Meet. La app la cruza con la transcripción para
  poner nombres.
- `captions`: subtítulos de Meet con hablante (respaldo si la transcripción
  falla). Pueden venir vacíos.
- Sin video (por ejemplo, falló el encoder) `video` es `null` y alcanza con el
  audio.

La app responde `200` y procesa en segundo plano: transcripción (la misma de
Voice, `lib/voice-transcribe.ts`), nombres de hablantes, análisis con IA,
vínculo con el CRM y avisos.

## Ciclo de un trabajo en el bot

1. Valida, responde 202 y arranca un Chromium con su propio Xvfb y sink de
   PulseAudio (un `null-sink` por trabajo; Chromium sale por ahí y ffmpeg graba
   el `.monitor`).
2. Abre la URL de Meet sin cuenta, apaga micrófono y cámara, escribe el nombre
   y pide entrar. Espera la admisión hasta `lobbyTimeoutSec`.
3. Adentro: manda el mensaje de consentimiento al chat de la reunión, prende
   los subtítulos y empieza a grabar (video de la pantalla de Xvfb + audio del
   sink en un MP4; segmentos de audio aparte).
4. Sale cuando la reunión termina, cuando queda solo `aloneTimeoutSec`, a los
   `maxDurationSec` o con `DELETE`.
5. Sube las partes, manda `complete`, borra los archivos locales.

Nunca escribe en logs tokens, URLs de callback con token, ni el secreto.

## Probar sin una reunión real

- En la app: `CALLS_BOT_FAKE=1` (los e2e). "Enviar el bot" simula una reunión
  de unos segundos con audio, subida, transcripción falsa y análisis falso.
- En el bot: `CALLS_BOT_FAKE_MEET=1` sirve una reunión falsa que imita la sala
  de espera, la admisión, el chat, los subtítulos con hablante y un audio que
  suena; `npm run selftest` corre un trabajo entero contra ella y un receptor
  local, y revisa con ffprobe que el video y los segmentos de audio sirvan.

## Probar con una reunión real de Google Meet (pasos para el dueño)

1. Crear una reunión en Google Calendar con Meet (o `meet.new`).
2. En la reunión, Controles del organizador: dejar "Acceso rápido" apagado
   (el bot pide entrar y hay que admitirlo) o prendido para pruebas.
3. En zerosoft › Calls › Próximas, "Enviar el bot ahora" con el link.
4. Admitir a "zerosoft Notetaker" en la reunión. Debería aparecer el mensaje
   de grabación en el chat.
5. Hablar un par de minutos y cortar la reunión para todos. En uno o dos
   minutos la llamada aparece en la biblioteca con video, transcripción y
   resumen.
