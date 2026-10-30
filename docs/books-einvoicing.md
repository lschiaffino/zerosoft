# Books: factura electrónica y cobros online

Qué tiene Books para la factura electrónica ante el fisco, qué falta y qué
tiene que conseguir cada empresa para conectarse. Al final, cómo configurar
Stripe y Mercado Pago para que las facturas se cobren online.

**Estado hoy:** Books tiene la interfaz de proveedor fiscal y un proveedor de
prueba que funciona de punta a punta. Los conectores reales con ARCA (ex
AFIP), con el SAT a través de un PAC y con Invopop **todavía no están
implementados**. Una factura autorizada con el proveedor de prueba no tiene
validez fiscal. En la página de paridad la fila figura como "parcial: gancho
listo, faltan las credenciales del proveedor".

## La interfaz (`lib/books-einvoice.ts`)

Cada proveedor implementa `EInvoiceProvider`:

- `id`: `test`, `afip`, `sat_cfdi` o `invopop`.
- `country`: el país del fisco (`AR`, `MX`) o `null` si es un agregador.
- `credentials`: la lista de datos que pide (CUIT, certificado, clave privada,
  punto de venta, etc.), con cuáles son secretos. La pantalla de ajustes se
  arma con esta lista.
- `authorize(doc)`: recibe la factura o nota de crédito ya emitida (emisor,
  receptor con su identificación fiscal y condición frente al IVA, letra,
  punto de venta, número, fecha, moneda, tipo de cambio, neto e impuesto por
  alícuota y total) y devuelve una de dos cosas:
  - autorizada: el código de autorización (CAE en Argentina, UUID del timbre
    en México), su vencimiento si lo hay y los datos extra que el PDF tiene
    que mostrar (por ejemplo el QR de ARCA);
  - rechazada: la lista de errores del fisco, para mostrarlos en la factura.

La factura guarda el resultado en `einvoice_status` y `einvoice_data`. Pedir
la autorización no cambia los importes: un documento emitido no se edita, se
corrige con una nota de crédito (que se autoriza igual).

Las credenciales se guardan cifradas con `lib/secret-box` (AES-256-GCM con
`ENCRYPTION_KEY`, o `NEXTAUTH_SECRET` si no está). No se vuelven a mostrar,
no van a un log y nunca se mandan a un modelo. Solo el owner y los admins
del workspace las pueden cargar o borrar.

## Proveedor de prueba

Se elige en **Books › Ajustes › Factura electrónica › Proveedor de prueba**.
No sale a internet: devuelve un CAE ficticio de 14 dígitos con vencimiento a
10 días, y rechaza una factura sin identificación fiscal del receptor cuando
la letra es A, como haría el fisco. Sirve para probar el flujo completo y
para los tests. Las facturas autorizadas así dicen "sin validez fiscal" en el
PDF.

## ARCA (ex AFIP), Argentina

Conector no implementado. Para el servicio web de factura electrónica
(`wsfe`, con autenticación por `wsaa`) la empresa necesita:

1. **CUIT** del emisor y su condición frente al IVA (Responsable Inscripto,
   Monotributo o Exento). La condición define la letra: un RI emite A a otro
   RI y B al resto; Monotributo y Exento emiten C.
2. **Punto de venta habilitado para Web Services.** Se da de alta en el sitio
   de ARCA, servicio "Administración de puntos de venta y domicilios", con el
   sistema "Factura Electrónica - Monotributo - Web Services" o "RECE para
   aplicativo y web services", según el caso. Tiene que ser un punto de venta
   distinto del que se usa en "Comprobantes en línea". En Books, la serie de
   numeración usa ese número de punto de venta.
3. **Certificado digital X.509 y su clave privada.** Se genera una clave
   privada y un pedido de certificado (CSR) con el CUIT y un alias, y se
   sube en el servicio "Administración de Certificados Digitales". ARCA
   devuelve el certificado (`.crt`). En Books se cargan el certificado, la
   clave privada y el alias.
4. **Relación con el servicio `wsfe`.** En el "Administrador de Relaciones
   de Clave Fiscal" hay que asociar el certificado (por su alias) al servicio
   "Facturación Electrónica".
5. **Ambiente.** Homologación (pruebas, con un certificado de homologación
   que se pide aparte) o producción. Son certificados distintos y Books los
   guarda por separado.

## SAT, CFDI 4.0, México

Conector no implementado. El timbrado de un CFDI lo hace un **PAC**
(proveedor autorizado de certificación), así que además de los datos del
SAT hace falta un contrato con un PAC. La empresa necesita:

1. **RFC** del emisor, **régimen fiscal** (por ejemplo 601 General de Ley
   Personas Morales o 626 RESICO) y el **código postal del domicilio
   fiscal** (lugar de expedición).
2. **Certificado de Sello Digital (CSD)**: el archivo `.cer`, la clave
   privada `.key` y su contraseña. Se tramita con la e.firma en el portal del
   SAT (aplicación Certifica). No es la e.firma: es un certificado aparte
   para sellar facturas.
3. **Cuenta con un PAC**: usuario y contraseña o API key del servicio de
   timbrado, y su ambiente de pruebas. Cada PAC tiene su API; el conector
   tiene que escribirse para el que se elija.
4. Del receptor, Books ya pide RFC (validado con su dígito verificador),
   nombre y código postal; el CFDI 4.0 además exige su régimen fiscal y el
   uso del CFDI, que hoy no se cargan.

## Invopop (agregador)

Conector no implementado. Invopop arma y envía la factura al fisco de varios
países con una sola API, a partir de documentos en su formato (GOBL). La
empresa necesita:

1. Una cuenta en Invopop y una **API key** (token de acceso) del workspace
   de Invopop.
2. Configurar en Invopop el flujo (workflow) del país y conectar ahí las
   credenciales que ese fisco pide (para México, el CSD; para otros países,
   lo que Invopop indique). Los países y servicios disponibles los define
   Invopop, no Books.
3. En Books se cargan la API key y el id del workflow.

## Cobros online: Stripe y Mercado Pago

Las facturas enviadas tienen un link público (revocable, sin indexar) donde
el cliente puede pagar si el workspace conectó Stripe o Mercado Pago. Todo se
carga en **Books › Ajustes › Cobros** (solo owner y admins), con las mismas
reglas que Shop (`docs/shop-payments.md`): las claves se prueban antes de
guardarse, se guardan cifradas y no se vuelven a mostrar.

### Stripe

1. Pegar la clave secreta (o una restringida con escritura en *Checkout
   Sessions*).
2. En Stripe › Developers › Webhooks, agregar el endpoint que muestra la
   pantalla, con la forma `https://<tu-app>/api/books/webhooks/stripe/<token>`,
   y los eventos `checkout.session.completed` y
   `checkout.session.async_payment_succeeded`.
3. Pegar el signing secret (`whsec_…`) del endpoint.

Books verifica la firma, acepta solo sesiones que creó para esa factura y
por el saldo en su moneda, registra el cobro una sola vez (cada evento queda
guardado y el cobro tiene una referencia única) y genera el asiento.

### Mercado Pago

1. Pegar el access token de producción (`APP_USR-…`) o de prueba (`TEST-…`).
2. En Tus integraciones › Webhooks, configurar la URL que muestra la
   pantalla, con la forma
   `https://<tu-app>/api/books/webhooks/mercadopago/<token>`, con el evento
   *Pagos*, y pegar la clave secreta de la firma.

Books verifica la firma `x-signature`, consulta el pago en Mercado Pago con
el token del comercio y solo lo registra si está aprobado, corresponde a la
factura y cobra el importe en su moneda.

El token de las URLs es propio del workspace: no lo compartas. Si se filtra,
generá una URL nueva en **Books › Ajustes › Cobros** (la anterior deja de
funcionar) y actualizala en Stripe y en Mercado Pago. Aunque alguien tenga la
URL, sin la firma del secreto ningún aviso registra un cobro.

## Otros datos a configurar

- `RESEND_API_KEY` (y `RESEND_EMAIL_DOMAIN` o `EMAIL_FROM`) para que las
  facturas y los recordatorios salgan por email; sin eso solo se escriben en
  el log del servidor.
- `NEXTAUTH_URL` con la URL pública de la app: arma el link de la factura y
  las URLs de los webhooks.
- La lectura de comprobantes con IA usa la cuota de IA del workspace (la
  misma del resto de la suite); sin IA configurada el botón avisa y el gasto
  se carga a mano.
- El cron horario (`/api/cron/tick`) emite las recurrentes, marca las
  vencidas y manda los recordatorios.
