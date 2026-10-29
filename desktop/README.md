# zerosoft para escritorio (Electron)

Una sola app para toda la plataforma, como Slack o Notion: carga `https://zerosoft.ai/app` (o tu
servidor, si usás zerosoft self-hosted) y suma lo que una pestaña del navegador no puede.

- **Ventana y bandeja:** recuerda tamaño y posición; cerrar la esconde (sigue en la barra de menú de
  Mac o en la bandeja de Windows con el dictado y los avisos); Salir la cierra.
- **Contador y avisos:** el ícono del dock (Mac) o un punto en la barra de tareas (Windows) muestra
  menciones y DMs sin leer de Talk más los avisos sin leer de la campana. Con la ventana sin foco,
  cada aviso nuevo sale como notificación del sistema y el clic abre su página
  (`GET /api/desktop/badge`, cada 30 s).
- **Login con Google en el navegador del sistema** (Google no deja entrar desde una webview):
  PKCE + código de un solo uso que vuelve por `zerosoft://auth/callback` y se canjea en
  `POST /api/desktop/token` (ver `lib/desktop-auth.ts`). La cookie de sesión queda en el cookie store
  de la ventana y una copia cifrada con `safeStorage` (Keychain / DPAPI) en `session.bin`.
- **Deep links** `zerosoft://open?path=/app/talk`, `zerosoft://notes` (validados campo por campo).
- **Abrir al iniciar sesión** (Ajustes) y **actualizaciones automáticas** (electron-updater contra
  `https://zerosoft.ai/api/desktop/update`, que sirve el `latest*.yml` del último release
  `desktop-v*` de GitHub).
- **Dictado en cualquier app (Wispr Flow):** mantener **Control + Option** en Mac o
  **Ctrl + Windows** en Windows (configurable: Option derecho, Control + Command, etc.) graba el
  micrófono con un overlay chico abajo al centro; al soltar, el audio va a `POST /api/voice/dictate`
  con la sesión, vuelve limpio (diccionario y estilo de Voice, contexto según la app de adelante) y
  se pega en la app que tiene el foco (portapapeles + Cmd/Ctrl+V simulado, y después se devuelve lo
  que había en el portapapeles). **Control + Option + Espacio** alterna sin mantener. Fn no está
  disponible: el hook de teclado (uiohook) no la expone.
- **Notas de reuniones (Granola), sin bot:** avisa cuando empieza un evento del calendario
  (`/api/voice/events`) o cuando Zoom, Meet o Teams están en llamada (proceso `CptHost` de Zoom y
  títulos de ventanas). "Tomar notas" abre Voice, crea la reunión y el grabador de la web empieza con
  **micrófono + audio del sistema**: `getDisplayMedia` con loopback (WASAPI en Windows,
  ScreenCaptureKit en Mac 13+), sin selector. Las notas quedan en Voice igual que una grabación web.

## Seguridad

- Todas las ventanas: `contextIsolation`, `sandbox`, sin `nodeIntegration`, sin `<webview>`.
- El preload de la app (`src/preload/app.ts`) expone `window.zerosoftDesktop` (versión, plataforma,
  `startLogin`, `openSettings`) solo si la página es del servidor configurado; main valida el origen
  del frame en cada IPC.
- Navegación estricta (`src/shared/nav.ts`): adentro solo el origen exacto del servidor; Google login
  va al navegador del sistema; el resto de http(s), mailto y tel, al navegador; cualquier otro
  esquema se bloquea. Permisos (micrófono, captura, avisos, portapapeles) solo para ese origen.
- Deep links validados (`src/shared/deeplink.ts`): forma y largo de código y state, paths solo de
  `/app`.

## Desarrollo

Requisitos: Node 20+. Las dependencias viven en `desktop/package.json` (nunca en la raíz).

```bash
cd desktop
npm install
npm start                                  # build + electron . contra https://zerosoft.ai
ZEROSOFT_SERVER=http://localhost:3000 npm start   # contra un next dev local
npm run typecheck
npm run pack                               # app sin firmar en release/mac-arm64/ (o win-unpacked)
npm run dist:mac                           # .dmg y .zip para arm64 y x64
npm run dist:win                           # instalador NSIS
```

Los tests de la lógica pura (deep links, navegación, atajo, reuniones) están en
`tests/unit/desktop-app.test.ts` y el e2e con Playwright `_electron` en
`tests/e2e/desktop-electron.spec.ts` (corre si `desktop/dist` está compilado).

## Permisos en Mac

La primera vez se abren los Ajustes de la app con el estado de cada permiso:

- **Micrófono:** dictado y reuniones (diálogo del sistema).
- **Accesibilidad:** escuchar el atajo en otras apps y simular el pegado. Sin ella sigue andando el
  atajo de alternar y el texto queda copiado para pegar a mano.
- **Grabación de pantalla y audio del sistema:** el audio de la llamada y los títulos de ventanas de
  Meet y Teams. Sin ella se graba solo el micrófono.

## Publicar

El workflow `.github/workflows/desktop.yml` corre con un tag `desktop-vX.Y.Z` (igual a la versión de
`desktop/package.json`), arma Mac (arm64 + x64) y Windows (x64) y los sube a un release de GitHub con
ese tag. La página `/download` toma los links del último release.

Sin secretos los instaladores salen **sin firmar**: en Mac hay que abrir con clic derecho › Abrir y
las actualizaciones automáticas no se instalan (Squirrel exige firma); en Windows SmartScreen avisa.

Secretos del repo para firmar:

| Secreto | Qué es |
|---|---|
| `CSC_LINK` | Certificado **Developer ID Application** exportado como .p12, en base64 |
| `CSC_KEY_PASSWORD` | Contraseña del .p12 |
| `APPLE_ID` | Apple ID de la cuenta de Apple Developer (USD 99/año) |
| `APPLE_APP_SPECIFIC_PASSWORD` | Contraseña de app de ese Apple ID (appleid.apple.com) |
| `APPLE_TEAM_ID` | Team ID de la cuenta de Apple Developer |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Opcional: certificado de firma de código para Windows (OV o EV) |

Del lado del servidor, opcionales: `DESKTOP_RELEASES_REPO` (otro repo de releases, p. ej. un fork) y
`DESKTOP_RELEASES_TOKEN` (token de GitHub de solo lectura, para no depender del cupo anónimo de la API).
