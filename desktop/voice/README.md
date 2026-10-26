# zerosoft Voice para escritorio (Tauri v2)

App de escritorio de Voice para macOS y Windows:

- **Dictado en cualquier app:** mantener el atajo global (`Control+Alt+Space` por defecto) graba el
  micrófono; al soltar, el audio va a `POST /api/v1/voice/dictate`, vuelve limpio (puntuación,
  muletillas, autocorrecciones, listas, diccionario y estilo de la persona) y se pega en la app
  activa (portapapeles + Cmd/Ctrl+V; después se restaura el portapapeles).
- **Reuniones con audio del sistema, sin bot:** desde la bandeja o la ventana, graba el micrófono
  (fuente `me`) y el audio del sistema (fuente `them`) y sube un trozo de cada uno cada 20 s a
  `POST /api/v1/voice/sessions/:id/chunks`. En zerosoft (Voice › Reuniones) aparece la
  transcripción con "Yo" y "Ellos", y ahí se arma la nota con IA, el chat y el envío a
  Docs, Notes, Track o el CRM.
  - macOS 13+: ScreenCaptureKit (`src-tauri/src/system_audio/macos.rs`).
  - Windows: WASAPI loopback con cpal (`src-tauri/src/audio.rs`, `capture_loopback`).
  - Sin permiso de captura (o en Linux) graba solo el micrófono.
- El audio no se guarda: se transcribe y se descarta. Los trozos en silencio no se suben.

## Estado

- **No está compilada ni probada en esta tanda**: la máquina donde se escribió no tiene Rust.
  `package-lock.json` está versionado; `Cargo.lock` todavía no (hace falta correr
  `cargo generate-lockfile` en `src-tauri/` con Rust instalado y commitearlo).
  La API que usa (`/api/v1/voice/*`) sí está probada con tests. El archivo más propenso a
  ajustes es `system_audio/macos.rs`, que sigue la API del crate `screencapturekit` 0.3.
- **No hay instaladores firmados.** Firmar y publicar necesita cuentas del dueño:
  - macOS: Apple Developer ID (certificado "Developer ID Application") y notarización
    (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY`).
  - Windows: certificado de firma de código (OV/EV) y su thumbprint en
    `bundle.windows.certificateThumbprint`.
  Sin firma, macOS muestra "desarrollador no identificado" (clic derecho › Abrir) y Windows
  SmartScreen avisa al instalar.
- Pendiente para una próxima tanda: aviso automático al empezar una reunión (detectar Zoom,
  Teams o Meet), actualizaciones automáticas (`tauri-plugin-updater`) y modo manos libres.

## Requisitos

- Rust estable (1.77+): https://rustup.rs
- Node 20+
- macOS: Xcode Command Line Tools (`xcode-select --install`).
- Windows: Microsoft C++ Build Tools y WebView2 (viene con Windows 11).

## Compilar

```bash
cd desktop/voice
npm install
npm run tauri dev      # desarrollo
npm run tauri build    # instaladores en src-tauri/target/release/bundle/
```

## Configurar

1. En zerosoft: Ajustes › API › crear una key con los scopes `voice:read` y `voice:write`.
2. Abrir zerosoft Voice, pegar la dirección del servidor (`https://zerosoft.ai/api/v1`, o la de
   tu instalación) y la key, y tocar "Save and test".
3. macOS pide permisos la primera vez: Micrófono, Grabación de pantalla y audio (para el audio
   del sistema) y Accesibilidad (para pegar).

El servidor, el atajo y el contexto quedan en `config.json` (directorio de configuración de la
app). La API key va al llavero del sistema (Keychain en macOS, Credential Manager en Windows,
Secret Service en Linux) con el crate `keyring`, nunca vuelve a la ventana (`get_config` solo
dice si hay una guardada) y solo viaja a servidores `https://` (http solo para localhost).

## API que usa

| Método | Ruta | Scope |
|---|---|---|
| POST | `/api/v1/voice/dictate` (multipart: `audio`, `context`, `sourceApp`, `durationMs`) | `voice:write` |
| POST | `/api/v1/voice/sessions` (`{ title }`) | `voice:write` |
| POST | `/api/v1/voice/sessions/:id/chunks` (multipart: `audio`, `source` me/them/mixed, `seq`, `offsetMs`, `durationMs`) | `voice:write` |
| PATCH | `/api/v1/voice/sessions/:id` (`{ status: "done" }`) | `voice:write` |
| GET | `/api/v1/voice/sessions`, `/api/v1/voice/sessions/:id` | `voice:read` |
| GET | `/api/v1/voice/dictionary` | `voice:read` |

Los trozos son idempotentes por (`source`, `seq`): un reintento no duplica la transcripción.
Cada pedido acepta hasta 4 MB (WAV de 16 kHz mono: unos 2 minutos), por eso el dictado se corta
a los 2 minutos y las reuniones van en trozos de 20 s.
