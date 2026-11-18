import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-shop-operations',
  date: '2026-11-18',
  title: {
    en: 'Shop: draft orders, returns, abandoned checkouts and automatic discounts',
    es: 'Shop: pedidos en borrador, devoluciones, carritos abandonados y descuentos automáticos',
    pt: 'Shop: pedidos em rascunho, devoluções, carrinhos abandonados e descontos automáticos',
  },
  items: [
    { product: 'shop', en: 'Create orders by hand, save them as drafts and send an invoice with a payment link.', es: 'Crear pedidos a mano, guardarlos como borrador y mandar la factura con un link de pago.', pt: 'Criar pedidos à mão, salvá-los como rascunho e enviar a fatura com um link de pagamento.' },
    { product: 'shop', en: 'Ship an order in parts, each shipment with its own tracking.', es: 'Enviar un pedido en partes, cada envío con su seguimiento.', pt: 'Enviar um pedido em partes, cada envio com seu rastreio.' },
    { product: 'shop', en: 'Returns with restock and refund, opened by your team or requested from the order page.', es: 'Devoluciones con reposición y reembolso, abiertas por tu equipo o pedidas desde la página del pedido.', pt: 'Devoluções com reposição e reembolso, abertas pela equipe ou solicitadas na página do pedido.' },
    { product: 'shop', en: 'Abandoned checkouts with a recovery link and an optional reminder email.', es: 'Carritos abandonados con link para recuperarlos y un recordatorio opcional por email.', pt: 'Carrinhos abandonados com link de recuperação e um lembrete opcional por email.' },
    { product: 'shop', en: 'Automatic discounts, buy X get Y, discounts by product or collection, and a discount per payment method.', es: 'Descuentos automáticos, lleve X pague Y, descuentos por producto o colección, y descuento por medio de pago.', pt: 'Descontos automáticos, leve X pague Y, descontos por produto ou coleção, e desconto por forma de pagamento.' },
    { product: 'shop', en: 'Pickup at a location, selling when out of stock, stock transfers and purchase orders.', es: 'Retiro en un local, venta sin stock, transferencias de stock y órdenes de compra.', pt: 'Retirada em um local, venda sem estoque, transferências de estoque e ordens de compra.' },
    { product: 'shop', en: 'Content pages and a blog, reports with CSV, a product feed for Google and Meta, and “My orders” by email link.', es: 'Páginas de contenido y blog, reportes con CSV, feed de productos para Google y Meta, y “Mis pedidos” con un link al email.', pt: 'Páginas de conteúdo e blog, relatórios com CSV, feed de produtos para Google e Meta, e “Meus pedidos” com um link por email.' },
  ],
} satisfies ChangelogEntry;
