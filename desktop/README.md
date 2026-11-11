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
- **Pegado:** portapapeles + Cmd+V simulado y 450 ms después se devuelve lo que había (texto o
  imagen), salvo que la persona haya copiado otra cosa en el medio (`src/clipboard.rs`). En Mac el
  Cmd+V es un CGEvent con solo Command (aunque Option siga apretado) y la tecla de la "v" se busca
  con la distribución de teclado actual en el hilo principal (las APIs de teclado de macOS lo
  exigen); en Windows, Ctrl+V con enigo. Sin Accesibilidad el texto queda copiado.
- **Velocidad:** mientras se graba se abre la conexión con el servidor; el pedido va con `fast=1`:
  frases de hasta 16 palabras se limpian por reglas, la IA (un modelo chico, `VOICE_CLEANUP_MODEL`)
  tiene un tope de 2 a 6 s y el historial se guarda después de contestar. El servidor devuelve
  `timings` (y `Server-Timing`) y Ajustes › Historial muestra dónde se fue el tiempo.
- **Sin conexión:** si el dictado no llega (red, sesión, servidor), el audio queda en
  `<datos>/pending/` (hasta 20, una semana) y se manda de nuevo desde la bandeja o el historial
  (`src/retry.rs`).
- **Pegar el último:** Control + Command + V (Mac) o Ctrl + Alt + Shift + V.
- **Velocidad:** cada dictado anota cuánto tardó desde soltar el atajo hasta el texto (se ve en
  Ajustes › Historial).

### Indicador de grabación (`ui/indicator.*`, `src/indicator.rs`)

Mientras una reunión de Voice se graba en la ventana y la ventana no está adelante (minimizada,
escondida o detrás de otra app), un recuadro chico arriba a la derecha, encima de todo, muestra el
reloj y deja Abrir la reunión o Cortar. La página avisa por el puente (`recording`); Cortar le
manda `zerosoft:stop-recording`. Se apaga en Ajustes › General. La bandeja también muestra Abrir y
Cortar mientras se graba.

### Rec: barra flotante y burbuja de la cámara (`ui/recbar.*`, `ui/recbubble.*`, `src/rec_overlay.rs`)

Mientras Rec graba en una pestaña (desde la 0.3.4), una barra chica queda encima de todas las apps:
punto rojo y reloj (se frena en pausa), nivel del micrófono (clic silencia), mostrar u ocultar la
cámara, Pausar o Seguir, Empezar de nuevo y Descartar (las dos preguntan en la misma barra) y
Terminar, que termina y trae adelante la pestaña (la subida y después el video). Atajos globales
solo mientras graba: Option+Shift+P pausa o sigue y Option+Shift+S termina (Alt+Shift en Windows).
La página cuenta su estado por el puente (`recOverlay`, `recLevel`); cada botón vuelve a esa
pestaña como el evento `zerosoft:rec-control` con un control de una lista fija
(`lib/rec-controls.ts`).

Con **pantalla y cámara** grabando la **pantalla entera** (`displaySurface: monitor`), la cara va en
una burbuja redonda flotante, como en Loom: se arrastra, se agranda o achica y se oculta, y la
captura de pantalla la graba donde quede. La página suelta la cámara, la burbuja la abre (página
local: el permiso de cámara se le da solo a ella) y la página deja de dibujar la cara en el video,
así no sale dos veces. Grabando una ventana o una pestaña, o si la burbuja no consigue la cámara
(`bubble-failed`), la página la sigue dibujando en el video como en el navegador.

Captura: la barra se excluye de la grabación (`content_protected`: NSWindowSharingNone en Mac,
WDA_EXCLUDEFROMCAPTURE en Windows 10 2004 o más; en Windows más viejos sale en el video). La burbuja
no se excluye: es la que pone la cara en el video. Dónde quedaron la barra y la burbuja y el tamaño
de la burbuja se recuerdan mientras la app está abierta.

### Ajustes (`ui/settings.*`)

Es el lugar de todos los ajustes de la app. Se abre desde el ícono de la barra de menú (o la
bandeja) › Ajustes, el menú zerosoft › Ajustes (Cmd+,) y el menú de la cuenta en la página ›
Ajustes de la app de escritorio. La primera vez se abre sola y lo explica.

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
- **Cámara:** Talk y Rec (NSCameraUsageDescription y `com.apple.security.device.camera`; sin las dos,
  macOS niega la cámara al webview y Rec no arrancaba ni la cámara ni el micrófono). La página de
  zerosoft recibe cámara y micrófono sin un segundo aviso del webview; otro origen, no.
- **Accesibilidad:** solo para simular el pegado. El atajo anda sin ella; sin ella el texto queda
  copiado. Con firma ad hoc el requisito de firma es el cdhash de la build: después de cada
  actualización la llave sigue prendida en Ajustes del Sistema pero es de la build vieja y
  `AXIsProcessTrusted` da false. Ajustes › Primeros pasos lo detecta (anota con qué versión se vio
  permitida), lo explica y **Restablecer permiso** borra la entrada vieja (`tccutil reset`), la pide
  de nuevo y abre la lista. Con el certificado propio (`MACOS_SIGNING_P12`, abajo) el requisito
  nombra el certificado y el permiso sigue entre versiones.

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
| `MACOS_SIGNING_P12`, `MACOS_SIGNING_P12_PASSWORD` | Certificado propio para firmar la app de Mac (lo crea y sube `sh desktop/scripts/macos-signing-cert.sh`). Sin ellos, firma ad hoc. |

Firma de código: en Mac, con los secretos de arriba, un certificado propio y fijo (los permisos de
macOS siguen entre versiones; el workflow falla si la app sale sin él y verifica cámara y micrófono).
Sin ellos, firma **ad hoc**. En los dos casos Gatekeeper pide la primera vez Ajustes del Sistema ›
Privacidad y seguridad › Abrir igualmente, hasta tener Developer ID. `workflow_dispatch` con
`signing_selftest` prueba el camino del certificado con uno descartable. En Windows, sin
certificado, SmartScreen avisa. Las actualizaciones no dependen de esa firma: el updater verifica su
propia firma (minisign) con la clave pública de la app.
