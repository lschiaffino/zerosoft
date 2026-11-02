# Benchmark: Send contra DocSend (Dropbox)

Leído el 2026-11-02. Base de `content/feature-parity/send.ts`. Cada fila de paridad sale de una de estas capacidades; ninguna se fusiona ni se saca para subir el número.

## Fuentes leídas

- Índice del centro de ayuda (118 artículos, sirve de lista de capacidades aunque no se haya leído cada uno): https://help.dropbox.com/docsend
- Qué es DocSend: https://help.dropbox.com/plans/what-is-dropbox-docsend
- Reglas de link en la biblioteca: https://help.dropbox.com/share/dropbox-docsend-link-settings-in-content-library
- Reglas de link en espacios: https://help.dropbox.com/share/dropbox-docsend-link-settings-in-spaces
- Permitir o bloquear: https://help.dropbox.com/share/dropbox-docsend-restrict-access-allow-or-block-viewers
- Verificación de email: https://help.dropbox.com/share/dropbox-docsend-email-authentication
- Watermarks: https://help.dropbox.com/share/dropbox-docsend-watermarks
- Acuerdos y NDA: https://help.dropbox.com/share/dropbox-docsend-agreements
- Actualizar contenido y versiones: https://help.dropbox.com/view-edit/dropbox-docsend-update-existing-content
- Rendimiento del documento: https://help.dropbox.com/share/dropbox-docsend-documents-performance-tab
- Actividad del documento: https://help.dropbox.com/share/dropbox-docsend-documents-activity-tab
- Tiempo por visitante: https://help.dropbox.com/share/dropbox-docsend-visitor-time-on-document
- Visitas de terceros y reenvíos: https://help.dropbox.com/share/does-dropbox-docsend-track-visits-from-unintended-visitors
- Límites de subida: https://help.dropbox.com/create-upload/dropbox-docsend-file-upload-limitations
- Reproductor de audio y video: https://help.dropbox.com/share/dropbox-docsend-audio-and-video-player
- Marca propia: https://help.dropbox.com/account-settings/dropbox-docsend-custom-branding
- Avisos por email: https://help.dropbox.com/account-settings/dropbox-docsend-email-notification-settings
- Permisos granulares de espacios: https://help.dropbox.com/organize/dropbox-docsend-granular-space-permissions
- Analítica de espacios: https://help.dropbox.com/organize/dropbox-docsend-data-room-analytics
- Plan Advanced Data Rooms: https://help.dropbox.com/plans/dropbox-docsend-advanced-data-rooms-plan
- Colaborar en un espacio: https://help.dropbox.com/organize/dropbox-docsend-collaborate-in-a-space-data-room
- Página de producto en Dropbox: https://www.dropbox.com/docsend

## Fuentes que fallaron

- `https://www.docsend.com/features/` y `https://www.docsend.com/pricing/`: 403 desde WebFetch. **La tabla oficial de planes no se leyó.** Los precios de DocSend no se citan en el sitio: el bloque de comparación remite a docsend.com/pricing.
- Precios de terceros (orangedox, peony, ellty, papermark, pitchwise): se contradicen entre sí y varios son competidores. Personal cerca de USD 10 por usuario es lo único en que coinciden; no se usa como dato.
- `help.docsend.com` (artículos de agreements, video player, límites): 403. Se leyó la versión espejo en help.dropbox.com.
- WebFetch resume con un modelo: puede omitir detalles. De los 118 artículos del índice se leyeron 22. Las capacidades del resto salen del título del artículo y quedan como `missing` si no están hechas; su alcance exacto no se verificó.

## Capacidades (para la paridad)

**Contenido.** PDF, PowerPoint (.ppt, .pptx), Word (.doc, .docx), Keynote, Excel y planillas (.xls, .xlsx, .gsheet, .ods, .csv; visor hasta 40 MB), video hasta 2 GB, audio hasta 1 GB, 500 páginas, archivos solo para descargar (texto, comprimidos), links externos, ZIP, subir desde Drive, Dropbox y otros, PDF con contraseña, carpetas, videos, GIF y links dentro del documento, notas internas, feedback dentro del documento, recomendaciones de contenido.

**Links.** Muchos por documento con nombre, URL propia (100 caracteres), código de acceso, email, verificación, permitir o bloquear (500 entradas, 2.000 en Data Rooms, CSV), descarga e impresión, vencimiento, watermark, acuerdo, mensaje de bienvenida, botón propio, incrustar, tarjeta de contacto, deshabilitar, borrar, ver como visitante, campañas, mail merge, links internos.

**Watermark.** Por link: texto libre, campos (IP, email, cuenta, fecha, hora), posición, en mosaico, rotación, color, tamaño, transparencia; default de la cuenta. No en video.

**Visor.** Sin cuenta, escritorio y móvil, saltar a página, pantalla completa, zoom, contactar al dueño. Video: pausa en segundo plano o en silencio, bloquear velocidad y saltos, teclado.

**Analítica.** Quién, dispositivo, sistema, ubicación con mapa, duración, tiempo por página con vista previa, % visto, clics en links del documento, descargas, firmas, insignias de NDA y de verificado; por documento y por versión: tiempo por página, dropoff, páginas top; Contactos con enriquecimiento; Cuentas; Tablero; visitas de empresa y personales; exportar CSV; visitas de fuentes atípicas. Tiempo: se pausa con la pestaña oculta; **no** hay corte por inactividad (el artículo cuenta una persona que se fue 5 minutos). Video: % reproducido, puntaje de atención, gráficos por tramo, diez segmentos.

**Avisos.** Al visitar (email, escritorio), link deshabilitado abierto, email no autorizado, firmas, resumen diario, resumen semanal, avisar a compañeros.

**Versiones.** Reemplazar actualiza todos los links; el tipo no puede cambiar en la actualización automática; comparar versiones en Rendimiento; el CSV dice la versión de cada visita; refrescar desde Dropbox o Drive, sincronización automática. No hay historial para restaurar.

**Espacios.** Crear, duplicar, plantillas, personalizar (título, subtítulo, imagen), carpetas (4.000 ítems), permisos granulares por link, grupo, carpeta y archivo (visible, descargable, watermark, NDA), grupos con invitación por email, índice numérico, analítica, CSV, auditoría, preguntas y respuestas, seguimiento de due diligence, avisos a visitantes, etiquetas, pedidos de archivos, colaboradores.

**Firma y acuerdos.** Firma de un clic y de una parte como acuerdo, certificado y auditoría, documentos firmables, exportar firmas, insignia en el contacto.

**Marca.** Subdominio, logo, color, URL del sitio.

**Equipo y plataforma.** Roles, sub-equipos, SSO, transferir datos, Salesforce (cuentas, Lightning, firmas), Zapier, IFTTT, extensión de Chrome, Gmail, Outlook, Dropbox, servidor MCP (beta), idiomas.

## Decisiones de seguridad (en el producto)

- Un token de link es de 192 bits. En la base solo está su hash; una copia cifrada deja volver a copiarlo desde el panel.
- Código de acceso con hash scrypt y dos topes (por IP y por link). Cambiar una regla de acceso vuelve a pasar a quien ya entró.
- Sin descarga, el navegador recibe imágenes por página, sin caché; el archivo no sale. Un video se puede capturar igual: el producto lo dice.
- Una lista de permitidos, un acuerdo y el acceso por persona de un espacio exigen verificación por código. DocSend solo la recomienda para las listas.
- Un link no publica más de lo que ve quien lo armó: si el dueño vuelve privado un documento, el link de otro deja de servirlo.
- Abrir la página no escribe nada: no hay sesión ni visita hasta un POST del navegador y unos segundos de lectura.
- MCP: crear un link, cambiar sus reglas, cambiar los documentos o el acceso de un espacio, reemplazar un archivo y cambiar la marca quedan solo en la web (`WEB_ONLY_RULES`), porque cambian qué muestra un link vivo y a quién; `sharing` se rechaza por campo (`field-policy.ts`). Lo público, las partes de subida y el render quedan excluidos; las URLs de links se tapan en las respuestas (`scrub.ts`). Borrar sigue disponible: solo corta acceso.
