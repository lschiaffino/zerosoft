# Cifrado

Cómo se protegen los datos en tránsito, en reposo y a nivel de campo, y cómo se rota la
clave maestra. Control relacionado: SOC 2 CC6.1 y CC6.7; ISO 27001:2022 A.8.24.

## En tránsito

- Navegador y API: HTTPS con TLS 1.2+ (Vercel). HTTP redirige a HTTPS y la app manda
  `Strict-Transport-Security` (headers base de next.config.mjs).
- Base de datos: `libsql://` a Turso va sobre TLS. Una URL `http://` solo se acepta para
  `file:` local o desarrollo.
- Servicios en Railway (Evolution/WhatsApp, voz y otros): se llaman por su dominio
  `https://` público; Railway termina TLS. Los webhooks salientes van firmados con
  HMAC-SHA256 y solo a hosts públicos (lib/safe-fetch.ts).
- Email (Resend) y proveedores de IA: APIs HTTPS.

## En reposo (proveedores)

| Dónde | Qué guarda | Cifrado del proveedor |
| --- | --- | --- |
| Turso | Base de datos y sus backups (point-in-time) | AES-256 en disco (documentación de Turso) |
| Vercel Blob | Archivos subidos | AES-256 en disco (almacenamiento de Vercel) |
| Railway | Volúmenes y Postgres de los servicios | Cifrado de disco del proveedor |
| Vercel (logs) | Logs de funciones | Retención y cifrado de Vercel |

Verificación pendiente del dueño: guardar como evidencia el informe SOC 2 / la página de
seguridad vigente de cada proveedor (ver `docs/security/vendors.md`).

## A nivel de campo (aplicación)

Encima del cifrado del proveedor, los secretos se cifran antes de llegar a la base, así
un volcado de la base o un backup no alcanza para usarlos:

- `lib/secret-box.ts`: tokens OAuth (Google, Microsoft, Slack, GitHub, redes sociales),
  claves de API de terceros (Stripe, Twilio, proveedores de IA de cada workspace),
  secretos de webhooks, configuración de cuentas de Inbox y Groups (incluidas las claves de
  la instancia de WhatsApp; la sesión misma vive en Evolution, en Railway), secretos TOTP de Robots y credenciales de importaciones.
- `lib/flow-credentials.ts`: credenciales de Flow y Robots, atadas al workspace (AAD).
- `lib/private-files.ts`: archivos privados (CVs de Hiring, PDFs de Sign, comprobantes de
  Books) cifrados antes de subirlos, con id de clave por archivo.
- Hashes, no cifrado: API keys (SHA-256), contraseñas de links (scrypt), códigos de login
  por email.
- Notas bloqueadas de Notes: cifradas en el navegador (PBKDF2 + AES-GCM); el servidor no
  tiene la clave (es el único caso de cifrado de punta a punta).

### Formato

Cifrado en sobre: cada valor tiene su propia clave de datos (DEK) aleatoria de 256 bits
que cifra el texto con AES-256-GCM (IV de 12 bytes, tag de 16 exigido al abrir). La DEK se
guarda envuelta con una subclave (HKDF) de la clave maestra, junto con el id de esa maestra:

```
enc:v2:<id de la maestra>:<DEK envuelta>.<iv>.<tag>.<datos>
```

Mientras `ENCRYPTION_KEYS` no esté configurada se sigue escribiendo el formato heredado
`enc:v1:` (AES-256-GCM directo con la clave `0`). Así el código nuevo se puede desplegar y
revertir sin tocar ningún dato; el sobre empieza cuando se configura la primera maestra.
Las credenciales de Flow siguen la misma regla (`cred:v1:` / `cred:v2:<id>:`); las `cred:v2`
ya no usan `CREDENTIALS_KEY`, que queda solo para leer las v1.

### Claves maestras

`ENCRYPTION_KEYS` (variable de entorno sensible en Vercel, nunca en el repo):

```
ENCRYPTION_KEYS="k2026b:<32 bytes base64>,k2026a:<32 bytes base64>"
```

La primera es la activa; las demás solo leen. En producción cada clave tiene que ser de 32
bytes aleatorios (`openssl rand -base64 32`); una frase se rechaza. Sin la variable, la
maestra es la heredada `0`: SHA-256 de `ENCRYPTION_KEY` (o de `NEXTAUTH_SECRET` si aquella
no existe; en producción hoy es `ENCRYPTION_KEY`).

**`ENCRYPTION_KEY` y `NEXTAUTH_SECRET` no se cambian ni se borran nunca**, aunque haya
`ENCRYPTION_KEYS`: de ellas derivan además los archivos privados, las credenciales v1, las
sesiones y varias firmas HMAC. Rotarlas es un procedimiento aparte.

Las maestras viven en las variables de entorno cifradas de Vercel, con acceso solo para
quienes administran el proyecto. Un KMS externo (AWS KMS, GCP KMS) se puede sumar después
guardando ahí la maestra y cargándola al arrancar; el formato ya guarda el id de clave.

## Rotación

Cada 12 meses, al irse alguien con acceso a producción, o ante sospecha de exposición:

1. Generar la clave nueva y ponerla primera en `ENCRYPTION_KEYS` (las anteriores quedan
   detrás). Desplegar. Desde ese momento todo lo nuevo se cifra con ella.
2. Esperar a que no queden instancias del deploy anterior (unos minutos): una instancia
   vieja todavía puede escribir con la clave anterior.
3. Con las mismas variables de producción, contar lo pendiente:
   `npx tsx scripts/rotate-encryption-keys.ts`
4. Volver a cifrar: `npx tsx scripts/rotate-encryption-keys.ts --apply`. Es idempotente y
   cada fila se actualiza con compare-and-set; se puede cortar y repetir. Recorre todas las
   tablas (no las virtuales de búsqueda), también valores dentro de un JSON.
5. Volver a contar. Con `Pending 0` y sin avisos, sacar la clave vieja de `ENCRYPTION_KEYS`.
   La primera vez, además, `ENCRYPTION_LEGACY_KEY=disabled` saca la clave `0` del anillo.
6. Registrar la rotación (fecha, quién, conteos) en el repositorio interno.

Si el script informa valores ilegibles (con su `tabla.columna#rowid`) o valores cifrados en
tablas sin rowid, no sacar ninguna clave hasta revisarlos. Un texto de usuario que solo
parece un valor cifrado también aparece como ilegible: se revisa y se ignora.

Los links de "reservar con esta persona" de Calendar llevan un valor cifrado en la URL: los
que ya se mandaron dejan de elegir a esa persona cuando se saca su clave (la reserva sigue
funcionando con el reparto normal).

Los archivos privados rotan aparte con `<APP>_FILES_KEY` y `<APP>_FILES_KEY_OLD`.

## Por qué no cifrado de punta a punta en todo

El cifrado de punta a punta (el servidor nunca puede leer los datos) no lo exige SOC 2,
ISO 27001 ni el GDPR, y rompería funciones centrales: búsqueda del lado del servidor,
asistente y agentes de IA, integraciones y webhooks, automatizaciones de Flow, edición
colaborativa en tiempo real, vistas previas y exportaciones. El estándar que piden los
auditores es TLS en tránsito, cifrado en reposo y control de acceso y de claves, que es lo
de arriba. El cifrado de punta a punta queda para funciones puntuales donde el servidor no
necesita leer nada (hoy, las notas bloqueadas; un cofre de notas privadas sería el
siguiente candidato).
