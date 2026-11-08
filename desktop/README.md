# zerosoft para escritorio (Tauri 2)

Una app nativa para Mac y Windows: carga `https://zerosoft.ai/app` (o tu servidor) con el webview del
sistema (WKWebView en Mac, WebView2 en Windows) y hace en Rust lo que una pestaña no puede. No trae un
Chromium propio.

Medido en una Mac mini con Apple silicon (build 0.2.0 del workflow, firma ad hoc):

| | Tauri 0.2.0 | Electron 0.1.2 |
|---|---|---|
| .dmg (Apple silicon) | 3,4 MB | 131 MB |
| .app instalada | 6,7 MB | 311 MB |
| Instalador de Windows | 2,6 MB | |
| Ventana creada, primer arranque | 1,4 s (2,1 s desde el exec, con la verificación de macOS) | |
| Ventana creada, arranques siguientes | 0,29 s (0,6 s desde el exec) | |
| Memoria en reposo (huella, todos los procesos) | 110 a 116 MB, de los que la app son 24 a 28 MB y el resto los procesos de WebKit (página, Ajustes y HUD) | |

La medición de memoria de Electron no salió comparable (no llegó a abrir el proceso de la página), por
eso queda vacía. Cómo se midió: el .app copiado del .dmg, abierto desde la terminal; la app escribe en
stderr `zs-timing main_window_created_ms` y `first_page_loaded_ms`, y la memoria es la suma de
`footprint` del proceso y de los procesos de WebKit nuevos, 25 s después de abrir.

## Qué hace

- **Ventana y bandeja:** recuerda tamaño y posición (`tauri-plugin-window-state`); cerrar la esconde
  (sigue en la barra de menú de Mac o en la bandeja de Windows con el dictado y los avisos); Salir la
  cierra. Menú de la app con Ajustes (Cmd+,), edición, atrás y adelante.
- **Sesión:** se entra con email dentro de la ventana, o con **Google en el navegador del sistema**
  (Google no deja entrar desde un webview): PKCE + código de un solo uso que vuelve por
  `zerosoft://auth/callback` y se canjea en `POST /api/desktop/token`; la cookie de sesión va al cookie
  store del webview, que la guarda. La app no guarda una copia propia del token: para sus pedidos lee la
  cookie del webview (`src/api.rs`, `src/auth.rs`).
- **Deep links** `zerosoft://open?path=/app/talk` (validados campo por campo, `src/deeplink.rs`).
- **Puente con la página** (`window.zerosoftDesktop`): versión, plataforma, `startLogin`, `openSettings` y
  `notify`, más un `window.Notification` que manda avisos nativos. Solo existe con el origen del
  servidor; la página solo puede llamar a esos cuatro comandos (capabilities) y cada comando revisa la
  ventana y el origen.
- **Contador y avisos:** el ícono del dock muestra menciones, DMs y avisos sin leer; con la ventana sin
  foco, cada aviso nuevo sale como notificación del sistema (`GET /api/desktop/badge`, cada 30 s).
- **Abrir al iniciar sesión** (`tauri-plugin-autostart`) y **actualizaciones** firmadas
  (`tauri-plugin-updater` contra `https://zerosoft.ai/api/desktop/update/latest.json`).

### Dictado en cualquier app, en Rust

- **Atajo global** (`tauri-plugin-global-shortcut`: Carbon en Mac, RegisterHotKey en Windows) con
  apretar y soltar, **sin pedir Accesibilidad**. Por defecto **Option + Espacio** en Mac y
  **Ctrl + Alt + Espacio** en Windows. Modo "los dos": mantener para hablar, o un toque corto para manos
  libres hasta el próximo toque; o solo uno de los dos. Esc cancela (se registra solo mientras graba).
  Un atajo de solo modificadores (Control + Option, Fn) no se puede registrar así: necesitaría un hook
  de teclado con Accesibilidad.
- **Micrófono** con cpal, en su propio hilo; se pasa a WAV de 16 kHz mono (`src/audio.rs`).
- **HUD** chico, sin foco y siempre encima, abajo al centro: nivel, reloj y pista (`ui/hud.*`).
- **Transcripción** en `POST /api/voice/dictate` con la sesión (`capture=desktop`): idioma, modo de
  limpieza, diccionario y estilos de Voice; contexto según la app de adelante (`lsappinfo`, sin permiso
  de automatización).
- **Pegado:** portapapeles + Cmd/Ctrl+V simulado (enigo) y 450 ms después se devuelve lo que había
  (texto o imagen), salvo que la persona haya copiado otra cosa en el medio (`src/clipboard.rs`). Sin
  Accesibilidad el texto queda copiado.
- **Sin conexión:** si el dictado no llega (red, sesión, servidor), el audio queda en
  `<datos>/pending/` (hasta 20, una semana) y se manda de nuevo desde la bandeja o el historial
  (`src/retry.rs`).
- **Pegar el último:** Control + Command + V (Mac) o Ctrl + Alt + Shift + V.
- **Velocidad:** cada dictado anota cuánto tardó desde soltar el atajo hasta el texto (se ve en
  Ajustes › Historial).

### Ajustes (`ui/settings.*`)

Primeros pasos (sesión, micrófono, Accesibilidad con links a Ajustes del Sistema y estado al día, y un
cuadro para probar), General (modo, atajo, portapapeles, abrir al iniciar), Voice (idioma, limpieza,
tono por app), Diccionario, Historial (copiar, pegar de nuevo, mandar de nuevo los guardados) y Cuenta.
Voice, Diccionario e Historial se leen y guardan en el servidor: son los mismos que
`/app/voice/settings` y `/app/voice/dictation`.

### Lo que la versión de Electron hacía y esta todavía no

- Notas de reuniones con el **audio del sistema** (getDisplayMedia con loopback) y el aviso cuando
  Zoom, Meet o Teams están en llamada. Las reuniones se graban desde la web (micrófono o pestaña).
- Tocar un aviso nativo no abre su página (el plugin de avisos de escritorio no tiene clic); abre la app.

## Permisos en Mac

- **Micrófono:** el dictado (diálogo del sistema la primera vez).
- **Accesibilidad:** solo para simular el pegado. El atajo anda sin ella; sin ella el texto queda
  copiado. Con firma ad hoc, macOS ata el permiso a la build exacta: **después de cada actualización
  hay que volver a darlo** (con un certificado de Developer ID eso deja de pasar).

## Desarrollo

Requisitos: Node 20+, Rust estable (`rustup`), y en Mac las Command Line Tools de Xcode.

```bash
cd desktop
npm install
ZEROSOFT_SERVER=http://localhost:3000 npm run dev   # contra un next dev local (solo en debug)
npm run typecheck                                   # páginas locales (TypeScript)
npm test                                            # cargo test: atajo, portapapeles, reintentos, deep links, navegación, audio
npm run build                                       # .app y .dmg (Mac) o instalador NSIS (Windows)
```

## Publicar

El workflow `.github/workflows/desktop.yml` corre con un tag `desktop-vX.Y.Z` (igual a la versión de
`package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`): tests de Rust, luego Mac Apple
silicon y Intel (`macos-15`) y Windows x64 con `tauri-action`, sin publicar. Un único job `publish`
crea el release, sube los instaladores con nombres fijos (`zerosoft-X.Y.Z-mac-arm64.dmg`,
`-mac-x64.dmg`, `-win-x64.exe`, que busca `/download`) y arma `latest.json` para el updater. Volver a
correr el workflow completa el release en vez de duplicarlo. Si una plataforma falla, `publish` sube
igual las que salieron; "Re-run failed jobs" en esa corrida rearma la que faltó y completa el release.

En Windows, NSIS (para el instalador) se deja antes del build en `%LOCALAPPDATA%\tauri\NSIS`, donde lo
busca tauri-bundler, desde un caché o con `scripts/provision-nsis.ps1` (varias fuentes, reintentos y el
mismo SHA-1 que fija Tauri). Así el build no depende de bajar NSIS de releases de GitHub, que respondió
504 en desktop-v0.2.0.

Secretos:

| Secreto | Qué es |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Clave privada del updater (la pública está en `tauri.conf.json`). Sin ella no hay actualizaciones automáticas. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Opcional, si la clave tiene contraseña. |

Firma de código: en Mac, firma **ad hoc** hasta que exista la cuenta de Apple Developer (la primera vez
hay que ir a Ajustes del Sistema › Privacidad y seguridad › Abrir igualmente). En Windows, sin
certificado, SmartScreen avisa. Las actualizaciones no dependen de esa firma: el updater verifica su
propia firma (minisign) con la clave pública de la app.
