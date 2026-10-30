# Shop: cobros con Stripe, Mercado Pago y transferencia

Qué tiene que configurar el comercio para cobrar en su tienda de Shop
(`/store/<handle>`). Todo se carga en **Shop › Ajustes › Cobros** (solo owner y
admins). Las claves se guardan cifradas con `lib/secret-box` (AES-256-GCM con
`ENCRYPTION_KEY`, o `NEXTAUTH_SECRET` si no está), no se vuelven a mostrar y
nunca van a un log ni a un modelo.

Los montos siempre los calcula el servidor (precio de cada variante, descuento,
envío e impuesto). Al proveedor se le manda **un solo renglón con el total del
pedido**; el detalle de ítems va en la descripción.

## Stripe (Checkout)

1. En el panel de Stripe › Developers › API keys, copiar la **clave secreta**
   (o una clave restringida con permiso de escritura en *Checkout Sessions* y
   *Refunds*, y lectura de *Balance*). Pegarla en "Clave secreta". Se prueba
   contra la API de Stripe antes de guardarla.
2. En Developers › Webhooks › *Add endpoint*:
   - URL: la que muestra Shop, con la forma
     `https://<tu-app>/api/shop/webhooks/stripe/<token>` (el token es propio de
     la tienda; no lo compartas).
   - Eventos: `checkout.session.completed` y
     `checkout.session.async_payment_succeeded` (pagos que se confirman más
     tarde, como boleto u OXXO).
3. Copiar el **signing secret** del endpoint (`whsec_…`) y pegarlo en "Secreto
   de firma del webhook".

Qué hace Shop con cada evento:

- Verifica la firma (`Stripe-Signature`, HMAC-SHA256, 5 minutos de margen).
- Solo acepta sesiones creadas por Shop (`metadata.source = zerosoft_shop`),
  que sean la sesión guardada en el pedido, que estén pagadas y que cobren el
  total exacto en la moneda del pedido.
- Marca el pedido pagado con compare-and-set (`pending → paid`): si Stripe
  reintenta o manda dos eventos, el pedido se marca una sola vez. Cada evento
  procesado queda en `shop_webhook_events`.
- Si el cliente vuelve del checkout antes que el webhook, la página del pedido
  consulta la sesión en Stripe (mismas reglas).

Reembolsos: desde el pedido (solo admins), total o parcial, con
`POST /v1/refunds` sobre el `payment_intent` del pago.

Monedas sin decimales (CLP, PYG, JPY…): Shop guarda centavos y divide por 100
al hablar con Stripe.

## Mercado Pago (Checkout Pro)

1. En [Tus integraciones](https://www.mercadopago.com/developers/panel/app),
   crear (o abrir) una aplicación de tipo Checkout Pro.
2. En *Credenciales de producción*, copiar el **Access token**
   (el de producción empieza con APP_USR; para pruebas, el de las credenciales de prueba) y pegarlo en
   "Access token". Se prueba con `GET /users/me` antes de guardarlo.
3. En *Webhooks* › *Configurar notificaciones*:
   - URL de producción: la que muestra Shop,
     `https://<tu-app>/api/shop/webhooks/mercadopago/<token>`.
   - Evento: **Pagos**.
   - Guardar y copiar la **clave secreta** que muestra Mercado Pago; pegarla en
     "Clave secreta del webhook".

Qué hace Shop con cada aviso:

- Verifica `x-signature` (`ts=…,v1=…`): HMAC-SHA256 con la clave secreta sobre
  `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, como documenta Mercado
  Pago, con 10 minutos de margen.
- El aviso no trae el monto: consulta el pago con `GET /v1/payments/<id>` y
  exige `status = approved`, que `external_reference` sea un pedido de esta
  tienda pagado con Mercado Pago, y el monto y la moneda exactos.
- Marca el pedido pagado con compare-and-set. Un pago aprobado queda en
  `shop_webhook_events`; uno pendiente no, así el aviso de aprobación posterior
  se procesa.

Las preferencias se crean con `notification_url` apuntando al mismo webhook,
`back_urls` a la página del pedido y vencimiento igual al tiempo de reserva de
stock. Reembolsos: `POST /v1/payments/<id>/refunds` (total o parcial) con una
`X-Idempotency-Key` por pedido y monto.

## Transferencia bancaria

En la misma pantalla: activar "Ofrecer transferencia", el nombre que ve el
cliente y las instrucciones (banco, titular, CBU/CVU o Pix, adónde mandar el
comprobante). El pedido queda **pendiente**, con el stock reservado y sin
vencer, hasta que alguien con Shop lo marca pagado desde el pedido. Ahí se
descuenta el stock y sale el email de confirmación.

## Reserva de stock y vencimiento

- Al crear el pedido se reserva el stock (compare-and-set sobre
  `available − reserved`). Si no alcanza, el checkout falla con "sin stock".
- Al pagar se descuenta (`available` y `reserved`, también compare-and-set).
- Un pedido online sin pagar vence a los 60 minutos (configurable en Ajustes ›
  Emails): el cron de cada minuto (`/api/cron/minute`) lo cancela, libera la
  reserva y devuelve el uso del código de descuento. Si el pago llega después
  igual se acepta: se descuenta de lo libre y, si ya no hay, el pedido queda
  marcado "Pagado sin stock" para reembolsar o reponer.

## Modo de prueba (desarrollo y e2e)

`SHOP_PAYMENTS_FAKE=1`: ninguna llamada sale a Stripe ni a Mercado Pago. Las
claves no se prueban contra la API, la sesión es `fake_cs_<pedido>` (Stripe) o
`fake_pref_<pedido>` (Mercado Pago) y el checkout vuelve directo a la página
del pedido. El pago lo marca un webhook **firmado de verdad** con el secreto
guardado (los e2e lo firman como Stripe) o "Marcar pagado". En Mercado Pago, un
`data.id` `fake<idDelPedido>` simula un pago aprobado por el total.

## Lo que no hace todavía

- Dominio propio para la tienda (vive en `/store/<handle>`).
- Webhooks salientes con eventos de Shop: usar los disparadores de Flow
  (`shop.order.created`, `shop.order.paid`, `shop.order.fulfilled`,
  `shop.inventory.low`), que pueden llamar a cualquier URL.
- Stripe Connect o cuentas de Mercado Pago por OAuth: cada comercio pega sus
  propias credenciales.
