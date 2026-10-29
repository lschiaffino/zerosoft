# zerosoft para iOS y Android (Capacitor)

Wrapper nativo de toda la plataforma: carga `https://zerosoft.ai/app` (`server.url` de
`capacitor.config.json`) con todas las apps (Talk, Voice, Docs, CRM, Track, Cal…). No hay código de
la app acá: es la web, con lo que el wrapper suma.

- **Login con Google:** Google no deja entrar desde una webview, así que el botón abre el navegador
  del sistema (plugin Browser: Safari View Controller / Custom Tabs) en `/api/desktop/login` con
  PKCE, vuelve por `zerosoft://auth/callback` (plugin App) y la página canjea el código en
  `/api/desktop/token` con `setCookie` (la cookie httpOnly la pone el servidor). Ver
  `lib/native-login.ts`.
- **Micrófono** para Voice y los huddles de Talk (permisos que agrega `scripts/configure-native.mjs`).
- Para un self-host, cambiá `server.url` y `allowNavigation` por tu dominio.

## Armar los proyectos

Requisitos: Node 20+, Xcode 16+ con CocoaPods (iOS) y Android Studio con JDK 21 (Android).

```bash
cd mobile
npm install
npm run add:ios        # cap add ios + esquema zerosoft:// y permiso de micrófono
npm run add:android    # cap add android + lo mismo
npm run sync
npm run open:ios       # o open:android, y de ahí Run / Archive
```

Los proyectos `ios/` y `android/` se generan y no se versionan.

## Qué hace falta para publicar en las tiendas

**App Store (iOS)**

- Cuenta de **Apple Developer Program** (USD 99/año) con acceso a App Store Connect.
- Un **App ID** `ai.zerosoft.app` y el perfil de distribución (Xcode lo maneja con "Automatically
  manage signing" si la cuenta está logueada en Xcode).
- En App Store Connect: ficha de la app, capturas (6,7" y 6,5" de iPhone; iPad si se publica para
  iPad), política de privacidad (`https://zerosoft.ai/privacy`), cuestionario de privacidad de datos y
  una **cuenta de prueba** para la revisión (Apple revisa con login: hace falta una cuenta de Google
  de prueba o un modo demo).
- Ojo con la guía 4.2 (apps que son "solo un sitio web"): la revisión puede pedir funciones nativas.
  Lo que hoy suma el wrapper es login nativo y micrófono; push nativo ayudaría (ver abajo).

**Google Play (Android)**

- Cuenta de **Google Play Console** (USD 25, pago único) y verificación de identidad.
- Un **keystore de subida** (`keytool -genkey -v -keystore upload.jks -alias upload -keyalg RSA
  -keysize 2048 -validity 10000`), guardado fuera del repo; Play App Signing guarda la clave final.
- Ficha, capturas, política de privacidad, formulario de seguridad de datos y, para cuentas nuevas
  de desarrollador personal, la prueba cerrada con 12 testers durante 14 días antes de producción.

## Push de Talk en el teléfono (todavía no)

El push de hoy es web push (VAPID, `lib/talk-push.ts`): funciona en la PWA instalada, pero no dentro
de la webview de Capacitor (ni WKWebView ni Android WebView soportan Web Push). Para push nativo
hace falta:

- **iOS:** una **APNs Auth Key** (.p8, Key ID y Team ID) de la cuenta de Apple Developer y la
  capability Push Notifications en Xcode.
- **Android:** un proyecto de **Firebase** (FCM) con su `google-services.json` y una cuenta de
  servicio para enviar.
- Del lado del servidor: guardar el token del dispositivo (plugin `@capacitor/push-notifications`) y
  mandar por APNs/FCM donde hoy se manda web push (`talkPush`, `groups-push`).

Mientras tanto, en el teléfono la opción con push es la PWA: abrir `zerosoft.ai/app` en Safari o
Chrome, "Agregar a pantalla de inicio" y activar los avisos en Talk.
