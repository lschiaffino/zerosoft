# Send: comprobar un deploy en Vercel

CI corre Send con `next start` en Linux y disco local. Esto no prueba lo propio de Vercel: el trazado de archivos de cada función (pdf.js y el lienzo nativo) y el almacenamiento en Blob. Hacelo una vez en un preview, y de nuevo si cambian `next.config.mjs`, `lib/send/render.ts` o la versión de `@napi-rs/canvas` o `pdfjs-dist`.

## Variables

| Variable | Para qué | Si falta |
|---|---|---|
| `SEND_BLOB_READ_WRITE_TOKEN` | Store de Blob **privado**. Recomendada. | Se usa `BLOB_READ_WRITE_TOKEN` |
| `BLOB_READ_WRITE_TOKEN` | Store público de la suite. Los archivos van cifrados antes de subir. | Sin ninguna de las dos, la subida responde `storage_unavailable` y no crea filas |
| `SEND_FILES_KEY` | Clave de los archivos cifrados. No cambia si se rota `NEXTAUTH_SECRET`. | Se deriva del secreto: rotarlo deja los archivos ilegibles salvo con `SEND_FILES_KEY_OLD` |
| `SEND_STORAGE_LIMIT_GB` | Cuota por workspace. | En Vercel, lo incluido en `lib/pricing.ts` (0,5 GB) |
| `RESEND_API_KEY` | Códigos de verificación y avisos. | No salen emails: un link con verificación no se puede abrir |

## Pasos

Con un preview con las variables de arriba, y un PDF, un .pptx, un .docx y un MP4 de más de 4 MB (para pasar por más de una parte):

1. **Trazado.** En la salida del build, o con `vercel inspect <url> --logs`, sin errores de `Module not found`. Abrí `/api/send/documents` con sesión: responde 200.
2. **PDF.** En `/app/send/new` subí el PDF. Tiene que llegar a "Links" sin error. Si dice "Este servidor no puede preparar páginas ahora", el motor no cargó: en los logs de la función, buscá `[send:render] engine`. La versión queda en cola y se reintenta sola: no hay que subirla de nuevo.
3. **Fuentes.** Un PDF con letras sin incrustar (Helvetica de pdf-lib alcanza) se tiene que ver con texto. Si las páginas salen sin texto, faltan `standard_fonts` en el trazado.
4. **Escaneado.** Un PDF con imágenes JPEG 2000 se tiene que ver con imagen. Si no, falta `pdfjs-dist/wasm`.
5. **Cron.** Subí un PDF grande y cerrá la pestaña durante "Preparando páginas". Volvé a los dos minutos: tiene que haber seguido. Prueba el trazado de `/api/cron/send-render`, que va aparte de `/api/cron/minute` y arranca `lib/send/render-worker.mjs` en un hilo.
6. **Link.** Armá un link con email, watermark y sin descarga. En una ventana privada, abrilo: las imágenes salen con el email dibujado. Prueba el lienzo y la fuente en la función de `/api/send/[...zsPath]`.
7. **Cookie.** En esa ventana, las herramientas de desarrollo tienen que mostrar `zs_send_*` con `HttpOnly`, `Secure` y `SameSite=Lax`.
8. **Encabezados.** `curl -sI <url del link>` tiene que traer `content-security-policy`, `x-frame-options: DENY`, `referrer-policy: no-referrer` y `x-robots-tag`.
9. **Video.** Subí el MP4 y miralo: tiene que poder saltar en la línea de tiempo (rangos entre partes).
10. **Descarga grande.** Con descarga y watermark, bajá el PDF de más de 4 MB: varias partes, un solo archivo que abre bien.
11. **Corte.** Deshabilitá el link: la pestaña abierta se cierra en menos de 20 s, y la URL de una imagen copiada responde 410.
12. **Email.** Un link con verificación manda el código, y al empezar la lectura llega un aviso sin entidades HTML en el título.

## Si algo falla

- **Motor que no carga:** revisá `outputFileTracingIncludes` en `next.config.mjs`. La versión queda con `render_unavailable` y sigue en cola: al desplegar el arreglo, el cron la termina. Nada se marca como fallido por esto.
- **Página que no termina:** el hilo se corta por tiempo (15 s por página) o memoria (1 GB). Tras 4 intentos sin página nueva, la versión falla con `page_too_complex`.
- **Error del servidor al renderizar:** `render_failed` tiene un botón Reintentar en el documento.
- **Sin Blob:** la subida responde antes de crear nada. Una parte que falla por esto deja la versión fallida, y el documento se puede borrar.

La lista de lo que todavía no se probó en un deploy real va en el informe de cada tanda.

## Self-host

Sumá una entrada más a tu cron, cada minuto, además de `/api/cron/minute`:

```
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/send-render
```

Sin ella, el render sigue mientras alguien tenga abierto el documento.
