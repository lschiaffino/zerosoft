# calls-bot (zerosoft Notetaker)

The meeting-recording bot behind zerosoft Calls. It joins a Google Meet as a
guest named "zerosoft Notetaker", posts a recording notice in the chat, records
the screen and the meeting audio, and uploads the result to the zerosoft app.
The protocol with the app is in [`docs/calls-bot.md`](../../docs/calls-bot.md).

Each job gets its own Xvfb display, its own PulseAudio null sink and its own
headful Chromium (Playwright). ffmpeg records the display plus the sink monitor
into an MP4 (H.264 + AAC, 1280x720, 15 fps) and, in parallel, Ogg/Opus mono
16 kHz segments of up to 10 minutes for transcription.

## Files

- `server.js`: HTTP API (`/v1/jobs`, `/v1/health`, `/v1/selftest` in fake mode)
- `job.js`: lifecycle of one job (join, record, leave, upload, complete)
- `platforms/meet.js`: Google Meet adapter; `platforms/index.js`: registry
- `lib/`: HMAC, validation, recorder, callback client, retries, timeline
- `fake-meet/`: a fake Meet page for tests (only with `CALLS_BOT_FAKE_MEET=1`)
- `selftest.js`: end-to-end test against the fake meeting

## Environment

| Variable | Meaning |
| --- | --- |
| `CALLS_BOT_SECRET` | Shared HMAC secret with the app (32+ characters, required). Removed from the process env after startup |
| `CALLS_BOT_SECRET_FILE` | Optional: read the secret from this file instead |
| `CALLS_ALLOWED_CALLBACK_ORIGINS` | Comma-separated https origins the bot may upload to, exact match |
| `CALLS_BOT_MAX_JOBS` | Concurrent meetings (default 2) |
| `CALLS_BOT_FAKE_MEET` | `1` serves `/fake-meet/<code>` and enables signed `POST /v1/selftest`. Tests only |
| `CALLS_BOT_DEV_HEADLESS` | `1` for local dev without Xvfb/PulseAudio (headless Chromium, synthetic recording) |
| `CALLS_BOT_SEGMENT_SEC` | Audio segment length (default 600) |
| `CALLS_BOT_CHROMIUM_SANDBOX` | `1` keeps Chromium's sandbox (needs user namespaces; off by default) |
| `CALLS_BOT_MEET_SPEAKING_SELECTOR` | Override for Meet's active-speaker indicator |
| `PORT` | HTTP port (default 8080) |

## Tests

```sh
npm install
npm test           # unit tests (node:test)
npm run selftest   # full job against the fake meeting + local receiver
```

On macOS the self-test runs in dev mode (headless Chromium, synthetic audio and
video). The real capture path (Xvfb + PulseAudio + ffmpeg) runs in the Linux
container: with `CALLS_BOT_FAKE_MEET=1` the signed `POST /v1/selftest` (body
`{"endsSec": 25}`) runs a fake meeting inside the container and returns the
ffprobe summary. It also checks that a newcomer gets the notice again, that a
meeting without chat is never recorded (`consent_not_sent`), and that a 404
from the app makes the bot leave and discard.

Never leave fake mode on in production: run the self-test on a separate
replica or service, or turn `CALLS_BOT_FAKE_MEET` off and redeploy right after.

```sh
body='{"endsSec":25}'; ts=$(date +%s)
sig=$(printf '%s.POST /v1/selftest.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$CALLS_BOT_SECRET" -hex | sed 's/^.* //')
curl -sS -X POST "$CALLS_BOT_URL/v1/selftest" -H "x-zs-timestamp: $ts" \
  -H "x-zs-signature: sha256=$sig" -H 'content-type: application/json' -d "$body"
```

## Deploy (Railway)

The service runs from this directory's `Dockerfile` (`railway.json` sets the
builder and the `/v1/health` healthcheck):

```sh
cd services/calls-bot
railway up --detach
```

Chromium runs without its own sandbox by default: Railway containers do not
allow the user namespaces it needs. The process runs as a non-root user, the
browser only navigates to allowlisted Meet hosts, and each job has its own
profile and temp dir that are deleted at the end.

## Security notes

- App requests are HMAC-signed over timestamp, method, path and body with a
  5-minute window, compared in constant time; a signature works only once
  (10-minute replay cache).
- The per-job callback token lives only in memory and is never logged; uploads
  refuse redirects and only go to allowlisted https origins. If the app answers
  401/403/404/409, the bot leaves at once, stops recording and deletes
  everything local.
- No consent notice in the chat, no recording (`consent_not_sent`). Each
  newcomer triggers the notice again (up to 10 times).
- Meeting URLs must be `https://meet.google.com/xxx-xxxx-xxx`. Frames may only
  navigate to Google hosts (google.com, gstatic.com, googleapis.com,
  googleusercontent.com, youtube.com); other requests must be https to public
  hosts. Popups are closed and service workers blocked. DNS names that resolve
  to private addresses are not checked.
- Each job's Xvfb requires its own X cookie (`-auth`). Chromium, ffmpeg and
  PulseAudio get a minimal environment without the secret.
- Bodies over 16 KB are rejected, requests must arrive within 30 s, at most 64
  connections. Temp files live in a 0700 dir per job and are removed when the
  job ends, as are Xvfb, the sink, Chromium and ffmpeg.
- Production runs one meeting per container (`CALLS_BOT_MAX_JOBS=1`).
