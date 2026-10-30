import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(
  id: string,
  area: string,
  label: L,
  status: ParityStatus,
  opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {},
): ParityRow {
  return {
    id,
    area,
    label: loc(label),
    ...(opts.detail ? { detail: loc(opts.detail) } : {}),
    status,
    competitorHas: opts.competitorHas ?? true,
    ...(opts.weight ? { weight: opts.weight } : {}),
  };
}

/**
 * Shop contra Shopify (y Tiendanube, la referencia en LATAM). Fuente: la
 * documentación pública de Shopify (Help Center: products, inventory,
 * checkout, orders, discounts, shipping, taxes) y de Tiendanube, leída el
 * 2026-10-29, contra el código de esta primera versión. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Shopify',
  lastReviewed: '2026-10-29',
  areas: [
    { id: 'catalog', label: loc(['Catalog', 'Catálogo', 'Catálogo']) },
    { id: 'inventory', label: loc(['Inventory', 'Inventario', 'Estoque']) },
    { id: 'storefront', label: loc(['Online store', 'Tienda online', 'Loja online']) },
    { id: 'checkout', label: loc(['Checkout and payments', 'Checkout y cobros', 'Checkout e pagamentos']) },
    { id: 'orders', label: loc(['Orders', 'Pedidos', 'Pedidos']) },
    { id: 'marketing', label: loc(['Discounts and marketing', 'Descuentos y marketing', 'Descontos e marketing']) },
    { id: 'customers', label: loc(['Customers', 'Clientes', 'Clientes']) },
    { id: 'analytics', label: loc(['Analytics', 'Analítica', 'Análises']) },
    { id: 'platform', label: loc(['Platform and integrations', 'Plataforma e integraciones', 'Plataforma e integrações']) },
  ],
  rows: [
    // Catálogo
    row('variants', 'catalog', ['Products with options and variants', 'Productos con opciones y variantes', 'Produtos com opções e variantes'], 'have', {
      weight: 2,
      detail: [
        'Up to 3 options (size, color…) and 250 variants per product, each with its own price, compare-at price, SKU, barcode, weight and photo',
        'Hasta 3 opciones (talle, color…) y 250 variantes por producto, cada una con precio, precio anterior, SKU, código de barras, peso y foto',
        'Até 3 opções (tamanho, cor…) e 250 variantes por produto, cada uma com preço, preço anterior, SKU, código de barras, peso e foto',
      ],
    }),
    row('product-media', 'catalog', ['Product photos', 'Fotos de producto', 'Fotos de produto'], 'partial', {
      detail: [
        'Several photos per product, checked by their bytes (PNG, JPEG, WebP, GIF, AVIF). No video, 3D models or image editing',
        'Varias fotos por producto, verificadas por sus bytes (PNG, JPEG, WebP, GIF, AVIF). Sin video, modelos 3D ni edición de imagen',
        'Várias fotos por produto, verificadas pelos bytes (PNG, JPEG, WebP, GIF, AVIF). Sem vídeo, modelos 3D nem edição de imagem',
      ],
    }),
    row('rich-description', 'catalog', ['Rich product description', 'Descripción con formato', 'Descrição com formatação'], 'partial', {
      detail: [
        'Paragraphs with bold, italics and links, sanitized like Docs. No rich text editor, tables or embedded media',
        'Párrafos con negrita, itálica y links, sanitizados como en Docs. Sin editor visual, tablas ni media embebida',
        'Parágrafos com negrito, itálico e links, sanitizados como no Docs. Sem editor visual, tabelas nem mídia incorporada',
      ],
    }),
    row('collections', 'catalog', ['Manual and automated collections', 'Colecciones manuales y automáticas', 'Coleções manuais e automáticas'], 'have', {
      weight: 2,
      detail: [
        'Pick products by hand, or rules on tag, type, brand, title and price (all or any)',
        'Elegir productos a mano, o reglas por etiqueta, tipo, marca, título y precio (todas o alguna)',
        'Escolher produtos à mão, ou regras por tag, tipo, marca, título e preço (todas ou alguma)',
      ],
    }),
    row('csv-import-export', 'catalog', ['Product CSV import and export', 'Importar y exportar productos por CSV', 'Importar e exportar produtos por CSV'], 'have', {
      weight: 2,
      detail: [
        'Shopify’s product CSV both ways (variants, stock, photos by URL, SEO); the export can go back into Shopify',
        'El CSV de productos de Shopify en los dos sentidos (variantes, stock, fotos por URL, SEO); la exportación se puede subir de vuelta a Shopify',
        'O CSV de produtos do Shopify nos dois sentidos (variantes, estoque, fotos por URL, SEO); a exportação pode voltar ao Shopify',
      ],
    }),
    row('tiendanube-import', 'catalog', ['Import from Tiendanube', 'Importar desde Tiendanube', 'Importar da Nuvemshop'], 'partial', {
      competitorHas: false,
      detail: [
        'Reads Tiendanube’s product export as documented in its help center (properties, promotional price, weight in kg, stock). Not checked against every export version; photos are not in that file',
        'Lee la exportación de productos de Tiendanube como la documenta su centro de ayuda (propiedades, precio promocional, peso en kg, stock). No se probó con todas las versiones del archivo; las fotos no vienen en él',
        'Lê a exportação de produtos da Nuvemshop como documentada no centro de ajuda (propriedades, preço promocional, peso em kg, estoque). Não testado com todas as versões do arquivo; as fotos não vêm nele',
      ],
    }),
    row('gift-cards', 'catalog', ['Gift cards', 'Gift cards', 'Vale-presente'], 'missing'),
    row('digital-products', 'catalog', ['Digital products and subscriptions', 'Productos digitales y suscripciones', 'Produtos digitais e assinaturas'], 'missing', {
      detail: [
        'A product can skip shipping, but there are no file downloads or recurring billing',
        'Un producto puede no llevar envío, pero no hay descargas ni cobro recurrente',
        'Um produto pode dispensar frete, mas não há downloads nem cobrança recorrente',
      ],
    }),
    row('product-seo', 'catalog', ['SEO title, description and URL handle', 'Título, descripción y URL para buscadores', 'Título, descrição e URL para buscadores'], 'have'),
    // Inventario
    row('multi-location', 'inventory', ['Stock per location', 'Stock por ubicación', 'Estoque por local'], 'partial', {
      weight: 2,
      detail: [
        'Up to 50 locations. Each order line ships from a single location (the default one first) and the store shows the stock of the best single location; one line is not split across locations',
        'Hasta 50 ubicaciones. Cada línea de un pedido sale de una sola ubicación (primero la por defecto) y la tienda muestra el stock de la mejor; una línea no se reparte entre ubicaciones',
        'Até 50 locais. Cada linha de um pedido sai de um só local (primeiro o padrão) e a loja mostra o estoque do melhor; uma linha não se divide entre locais',
      ],
    }),
    row('inventory-history', 'inventory', ['Adjustments with history', 'Ajustes con historial', 'Ajustes com histórico'], 'have', {
      detail: [
        'Add, remove or count, with a reason; sales, cancellations, refunds and imports are logged too',
        'Sumar, restar o contar, con motivo; también quedan las ventas, cancelaciones, reembolsos e importaciones',
        'Somar, tirar ou contar, com motivo; vendas, cancelamentos, reembolsos e importações também ficam registrados',
      ],
    }),
    row('no-overselling', 'inventory', ['No overselling', 'Sin sobreventa', 'Sem venda acima do estoque'], 'have', {
      weight: 2,
      detail: [
        'Stock is reserved when the order is placed and taken out at payment with compare-and-set; unpaid orders release it after the hold time. A payment that arrives after the hold expired and the unit was sold is flagged for a refund',
        'El stock se reserva al crear el pedido y se descuenta al pagar con compare-and-set; los pedidos sin pagar lo liberan pasado el tiempo de reserva. Un pago que llega después de vencida la reserva, con la unidad ya vendida, queda marcado para reembolsar',
        'O estoque é reservado ao criar o pedido e baixado no pagamento com compare-and-set; pedidos não pagos o liberam depois do tempo de reserva. Um pagamento que chega depois de vencida a reserva, com a unidade já vendida, fica marcado para reembolso',
      ],
    }),
    row('low-stock-alerts', 'inventory', ['Low stock alerts', 'Avisos de stock bajo', 'Avisos de estoque baixo'], 'have', {
      detail: [
        'Threshold per store; notification to admins and a Flow trigger',
        'Umbral por tienda; aviso a los admins y disparador de Flow',
        'Limite por loja; aviso aos admins e gatilho do Flow',
      ],
    }),
    row('transfers-purchase-orders', 'inventory', ['Transfers between locations and purchase orders', 'Transferencias entre ubicaciones y órdenes de compra', 'Transferências entre locais e ordens de compra'], 'missing'),
    row('backorders', 'inventory', ['Keep selling when out of stock', 'Seguir vendiendo sin stock', 'Continuar vendendo sem estoque'], 'partial', {
      detail: [
        'Only by turning off stock tracking for the variant',
        'Solo apagando el control de stock de la variante',
        'Só desligando o controle de estoque da variante',
      ],
    }),
    // Tienda
    row('storefront', 'storefront', ['Online store: home, collections, product, cart, search', 'Tienda online: portada, colecciones, producto, carrito, búsqueda', 'Loja online: início, coleções, produto, carrinho, busca'], 'have', {
      weight: 2,
      detail: [
        'At /store/<handle>, in the store language (English, Spanish or Portuguese), built for phones first',
        'En /store/<handle>, en el idioma de la tienda (inglés, español o portugués), pensada primero para el celular',
        'Em /store/<handle>, no idioma da loja (inglês, espanhol ou português), pensada primeiro para o celular',
      ],
    }),
    row('themes', 'storefront', ['Themes and brand', 'Temas y marca', 'Temas e marca'], 'partial', {
      weight: 2,
      detail: [
        'Three themes with your logo, two colors, a font and home page texts. No theme store, section editor or custom code',
        'Tres temas con tu logo, dos colores, una tipografía y textos de portada. Sin tienda de temas, editor de secciones ni código propio',
        'Três temas com seu logo, duas cores, uma fonte e textos da página inicial. Sem loja de temas, editor de seções nem código próprio',
      ],
    }),
    row('seo-structured-data', 'storefront', ['SEO: meta tags, sitemap and product structured data', 'SEO: meta tags, sitemap y datos estructurados', 'SEO: meta tags, sitemap e dados estruturados'], 'have', {
      detail: [
        'Title, description, canonical and Open Graph per page; sitemap.xml per store; Product JSON-LD with one offer per variant',
        'Título, descripción, canonical y Open Graph por página; sitemap.xml por tienda; JSON-LD de Product con una oferta por variante',
        'Título, descrição, canonical e Open Graph por página; sitemap.xml por loja; JSON-LD de Product com uma oferta por variante',
      ],
    }),
    row('fast-pages', 'storefront', ['Cached pages refreshed on change', 'Páginas en caché que se regeneran al cambiar', 'Páginas em cache regeneradas ao mudar'], 'have', {
      detail: [
        'Catalog pages are generated once and regenerated when you change the store, or every 5 minutes; cart and order pages load in the browser',
        'Las páginas del catálogo se generan una vez y se regeneran cuando cambiás la tienda, o cada 5 minutos; carrito y pedido cargan en el navegador',
        'As páginas do catálogo são geradas uma vez e regeneradas quando você muda a loja, ou a cada 5 minutos; carrinho e pedido carregam no navegador',
      ],
    }),
    row('custom-domain', 'storefront', ['Custom domain', 'Dominio propio', 'Domínio próprio'], 'missing', {
      detail: [
        'The store lives on the zerosoft address; custom domains of Link and Docs don’t serve stores',
        'La tienda vive en la dirección de zerosoft; los dominios propios de Link y Docs no sirven tiendas',
        'A loja fica no endereço do zerosoft; os domínios próprios do Link e do Docs não servem lojas',
      ],
    }),
    row('blog-pages', 'storefront', ['Blog and content pages', 'Blog y páginas de contenido', 'Blog e páginas de conteúdo'], 'missing'),
    row('multi-currency-language', 'storefront', ['Several currencies and languages per store', 'Varias monedas e idiomas por tienda', 'Várias moedas e idiomas por loja'], 'missing', {
      detail: ['One currency and one language per store', 'Una moneda y un idioma por tienda', 'Uma moeda e um idioma por loja'],
    }),
    // Checkout
    row('guest-checkout', 'checkout', ['Guest checkout', 'Checkout como invitado', 'Checkout como convidado'], 'have', { weight: 2 }),
    row('server-totals', 'checkout', ['Prices and totals computed on the server', 'Precios y totales calculados en el servidor', 'Preços e totais calculados no servidor'], 'have', {
      detail: [
        'The cart only sends variant and quantity; price, discount, shipping and tax come from the store data',
        'El carrito solo manda variante y cantidad; precio, descuento, envío e impuesto salen de los datos de la tienda',
        'O carrinho só manda variante e quantidade; preço, desconto, frete e imposto vêm dos dados da loja',
      ],
    }),
    row('stripe', 'checkout', ['Card payments (Stripe Checkout)', 'Pagos con tarjeta (Stripe Checkout)', 'Pagamentos com cartão (Stripe Checkout)'], 'have', {
      weight: 2,
      detail: [
        'With your own Stripe account; signed webhook marks the order paid once',
        'Con tu cuenta de Stripe; el webhook firmado marca el pedido pagado una sola vez',
        'Com sua conta Stripe; o webhook assinado marca o pedido como pago uma vez',
      ],
    }),
    row('mercadopago', 'checkout', ['Mercado Pago (Checkout Pro)', 'Mercado Pago (Checkout Pro)', 'Mercado Pago (Checkout Pro)'], 'have', {
      weight: 2,
      detail: [
        'Built in with your access token and signed webhooks (on Shopify it comes as Mercado Pago’s own app)',
        'Integrado con tu access token y webhooks firmados (en Shopify llega como la app de Mercado Pago)',
        'Integrado com seu access token e webhooks assinados (no Shopify chega como o app do Mercado Pago)',
      ],
    }),
    row('manual-payment', 'checkout', ['Bank transfer and other manual payments', 'Transferencia y otros pagos manuales', 'Transferência e outros pagamentos manuais'], 'have', {
      detail: [
        'Your instructions on the order page; the order waits until you mark it as paid',
        'Tus instrucciones en la página del pedido; el pedido espera hasta que lo marcás pagado',
        'Suas instruções na página do pedido; o pedido espera até você marcar como pago',
      ],
    }),
    row('shipping-rates', 'checkout', ['Shipping rates: flat, by weight, by zone, free over an amount', 'Envíos: fijo, por peso, por zona, gratis desde un monto', 'Frete: fixo, por peso, por zona, grátis a partir de um valor'], 'have', { weight: 2 }),
    row('carrier-rates', 'checkout', ['Live carrier rates and labels', 'Tarifas de transportistas en vivo y etiquetas', 'Tarifas de transportadoras ao vivo e etiquetas'], 'missing', {
      detail: [
        'No Correo Argentino, Andreani, Correios or UPS integration yet',
        'Todavía sin integración con Correo Argentino, Andreani, Correios o UPS',
        'Ainda sem integração com Correios, Correo Argentino, Andreani ou UPS',
      ],
    }),
    row('taxes', 'checkout', ['Taxes', 'Impuestos', 'Impostos'], 'partial', {
      detail: [
        'One rate per country and region, added or included in the price (VAT style), optionally on shipping. No automatic tax calculation or tax IDs on invoices',
        'Una tasa por país y región, sumada o incluida en el precio (estilo IVA), opcional sobre el envío. Sin cálculo automático ni facturación electrónica',
        'Uma taxa por país e região, somada ou incluída no preço, opcional sobre o frete. Sem cálculo automático nem nota fiscal',
      ],
    }),
    row('abandoned-checkout', 'checkout', ['Abandoned checkout emails', 'Emails de carrito abandonado', 'Emails de carrinho abandonado'], 'missing'),
    row('checkout-rate-limits', 'checkout', ['Abuse limits on checkout and discount codes', 'Límites contra abuso en el checkout y los códigos', 'Limites contra abuso no checkout e nos cupons'], 'partial', {
      detail: [
        'Limits per IP on orders placed, unknown discount codes and order lookups, plus a bot trap field. No fraud analysis of its own: card checks are the payment provider’s',
        'Límites por IP en pedidos creados, códigos inexistentes y búsquedas de pedidos, más un campo trampa para bots. Sin análisis de fraude propio: el control de tarjetas es del proveedor de pagos',
        'Limites por IP em pedidos criados, cupons inexistentes e buscas de pedidos, mais um campo-armadilha para bots. Sem análise de fraude própria: o controle de cartões é do provedor de pagamentos',
      ],
    }),
    // Pedidos
    row('order-management', 'orders', ['Order list and detail with statuses', 'Lista y detalle de pedidos con estados', 'Lista e detalhe de pedidos com status'], 'have', { weight: 2 }),
    row('fulfillment', 'orders', ['Fulfill with tracking number', 'Envío con número de seguimiento', 'Envio com código de rastreio'], 'have', {
      detail: [
        'Whole order at once, with carrier and tracking link; no partial fulfillments',
        'El pedido completo, con transportista y link de seguimiento; sin envíos parciales',
        'O pedido inteiro, com transportadora e link de rastreio; sem envios parciais',
      ],
    }),
    row('refunds', 'orders', ['Refunds through the payment provider', 'Reembolsos por el proveedor de pago', 'Reembolsos pelo provedor de pagamento'], 'have', {
      detail: [
        'Full or partial, through Stripe or Mercado Pago, with restock on full refunds. Cancelling a paid order can refund it in the same step, and a payment that lands on a cancelled order is recorded and flagged for a refund',
        'Total o parcial, por Stripe o Mercado Pago, con reposición en los reembolsos totales. Cancelar un pedido pagado puede reembolsarlo en el mismo paso, y un pago que llega a un pedido cancelado queda registrado y marcado para reembolsar',
        'Total ou parcial, pelo Stripe ou Mercado Pago, com reposição nos reembolsos totais. Cancelar um pedido pago pode reembolsá-lo no mesmo passo, e um pagamento que chega a um pedido cancelado fica registrado e marcado para reembolso',
      ],
    }),
    row('order-timeline', 'orders', ['Timeline and internal notes', 'Línea de tiempo y notas internas', 'Linha do tempo e notas internas'], 'have'),
    row('customer-emails', 'orders', ['Order confirmation and shipping emails', 'Emails de confirmación y de envío', 'Emails de confirmação e de envio'], 'have', {
      detail: [
        'In the store language, with your logo; templates are not editable yet',
        'En el idioma de la tienda, con tu logo; las plantillas todavía no se editan',
        'No idioma da loja, com seu logo; os modelos ainda não são editáveis',
      ],
    }),
    row('packing-slip', 'orders', ['Printable packing slip', 'Remito para imprimir', 'Romaneio para imprimir'], 'have'),
    row('draft-orders-pos', 'orders', ['Draft orders and point of sale', 'Pedidos en borrador y punto de venta', 'Pedidos em rascunho e ponto de venda'], 'missing'),
    row('returns-exchanges', 'orders', ['Returns and exchanges', 'Devoluciones y cambios', 'Devoluções e trocas'], 'missing'),
    // Marketing
    row('discount-codes', 'marketing', ['Discount codes', 'Códigos de descuento', 'Cupons de desconto'], 'have', {
      weight: 2,
      detail: [
        'Percentage, fixed amount or free shipping, with minimum order, usage limit and dates',
        'Porcentaje, monto fijo o envío gratis, con compra mínima, tope de usos y fechas',
        'Porcentagem, valor fixo ou frete grátis, com pedido mínimo, limite de usos e datas',
      ],
    }),
    row('automatic-discounts', 'marketing', ['Automatic discounts and buy X get Y', 'Descuentos automáticos y lleve X pague Y', 'Descontos automáticos e leve X pague Y'], 'missing'),
    row('utm-links', 'marketing', ['Short links with UTM for products', 'Links cortos con UTM para productos', 'Links curtos com UTM para produtos'], 'better', {
      competitorHas: false,
      detail: [
        'One click creates a Link short link with campaign tags, with its click analytics',
        'Un clic crea un link corto de Link con etiquetas de campaña, con su analítica de clics',
        'Um clique cria um link curto do Link com tags de campanha, com análise de cliques',
      ],
    }),
    row('sales-channels', 'marketing', ['Marketplaces and social channels', 'Marketplaces y canales sociales', 'Marketplaces e canais sociais'], 'missing', {
      detail: ['No Mercado Libre, Google or Meta catalog sync', 'Sin sincronizar con Mercado Libre, Google o Meta', 'Sem sincronizar com Mercado Livre, Google ou Meta'],
    }),
    // Clientes
    row('customer-list', 'customers', ['Customer list with orders and spend', 'Lista de clientes con pedidos y gasto', 'Lista de clientes com pedidos e gasto'], 'have'),
    row('crm-sync', 'customers', ['Customers in the CRM with each order', 'Clientes en el CRM con cada pedido', 'Clientes no CRM com cada pedido'], 'better', {
      competitorHas: false,
      detail: [
        'Each paid order creates or updates the CRM contact and logs the order on it',
        'Cada pedido pagado crea o actualiza el contacto del CRM y deja el pedido en su ficha',
        'Cada pedido pago cria ou atualiza o contato do CRM e registra o pedido nele',
      ],
    }),
    row('order-status-page', 'customers', ['Order status page by number and email', 'Estado del pedido por número y email', 'Status do pedido por número e email'], 'have'),
    row('customer-accounts', 'customers', ['Customer accounts', 'Cuentas de clientes', 'Contas de clientes'], 'missing', {
      detail: ['Checkout is always as a guest', 'El checkout es siempre como invitado', 'O checkout é sempre como convidado'],
    }),
    // Analítica
    row('sales-dashboard', 'analytics', ['Sales, orders, average order and conversion', 'Ventas, pedidos, ticket promedio y conversión', 'Vendas, pedidos, ticket médio e conversão'], 'have', {
      detail: [
        '7, 30, 90 or 365 days, sales per day and top products. Conversion counts page views, not unique sessions',
        '7, 30, 90 o 365 días, ventas por día y más vendidos. La conversión cuenta páginas vistas, no sesiones únicas',
        '7, 30, 90 ou 365 dias, vendas por dia e mais vendidos. A conversão conta páginas vistas, não sessões únicas',
      ],
    }),
    row('reports', 'analytics', ['Custom reports and exports', 'Reportes a medida y exportaciones', 'Relatórios personalizados e exportações'], 'missing'),
    // Plataforma
    row('flow-triggers', 'platform', ['Automations on orders and stock', 'Automatizaciones con pedidos y stock', 'Automações com pedidos e estoque'], 'have', {
      detail: [
        'Flow triggers: order placed, paid, fulfilled and low stock',
        'Disparadores de Flow: pedido creado, pagado, enviado y stock bajo',
        'Gatilhos do Flow: pedido criado, pago, enviado e estoque baixo',
      ],
    }),
    row('ai-assistant', 'platform', ['AI assistant over the store', 'Asistente de IA sobre la tienda', 'Assistente de IA sobre a loja'], 'have', {
      detail: [
        'Ask about orders, stock and sales; create products, discounts or fulfill orders after confirming',
        'Preguntar por pedidos, stock y ventas; crear productos, descuentos o enviar pedidos después de confirmar',
        'Perguntar sobre pedidos, estoque e vendas; criar produtos, descontos ou enviar pedidos depois de confirmar',
      ],
    }),
    row('support-agent', 'platform', ['Support agent that checks order status', 'Agente de soporte que consulta pedidos', 'Agente de suporte que consulta pedidos'], 'better', {
      competitorHas: false,
      detail: [
        'Agents look up an order by number and email (both must match)',
        'Agents consulta un pedido por número y email (los dos tienen que coincidir)',
        'O Agents consulta um pedido por número e email (os dois precisam bater)',
      ],
    }),
    row('api', 'platform', ['API', 'API', 'API'], 'partial', {
      detail: [
        'List products and orders and create products with an API key; no webhooks of Shop events yet (use Flow)',
        'Listar productos y pedidos y crear productos con una API key; todavía sin webhooks de eventos de Shop (usá Flow)',
        'Listar produtos e pedidos e criar produtos com uma API key; ainda sem webhooks de eventos do Shop (use o Flow)',
      ],
    }),
    row('app-store', 'platform', ['App store', 'Tienda de apps', 'Loja de apps'], 'missing'),
    row('staff-permissions', 'platform', ['Staff access', 'Acceso del equipo', 'Acesso da equipe'], 'partial', {
      detail: [
        'Shop on or off per person; payments and refunds only for admins. No per-section permissions',
        'Shop prendida o apagada por persona; cobros y reembolsos solo para admins. Sin permisos por sección',
        'Shop ligado ou desligado por pessoa; pagamentos e reembolsos só para admins. Sem permissões por seção',
      ],
    }),
  ],
};

export default parity;
