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
 * Books contra Xero (planes y docs públicos, 2026-10-30), con notas de
 * Argentina y México. QuickBooks, Alegra, Colppy y Odoo solo de referencia.
 * La factura electrónica queda en parcial: el gancho existe, los conectores
 * reales con ARCA y el SAT todavía no.
 */
const parity: ProductParity = {
  competitor: 'Xero',
  alsoCompared: ['QuickBooks Online', 'Alegra', 'Colppy', 'Odoo Invoicing'],
  lastReviewed: '2026-10-30',
  areas: [
    { id: 'invoicing', label: loc(['Invoicing', 'Facturación', 'Faturamento']) },
    { id: 'einvoicing', label: loc(['E-invoicing', 'Factura electrónica', 'Nota fiscal eletrônica']) },
    { id: 'purchases', label: loc(['Bills and expenses', 'Compras y gastos', 'Compras e despesas']) },
    { id: 'inventory', label: loc(['Products and inventory', 'Productos e inventario', 'Produtos e estoque']) },
    { id: 'banking', label: loc(['Banking', 'Bancos', 'Bancos']) },
    { id: 'accounting', label: loc(['Accounting', 'Contabilidad', 'Contabilidade']) },
    { id: 'reports', label: loc(['Reports', 'Informes', 'Relatórios']) },
    { id: 'contacts', label: loc(['Contacts', 'Contactos', 'Contatos']) },
    { id: 'team', label: loc(['Team and control', 'Equipo y control', 'Equipe e controle']) },
    { id: 'integrations', label: loc(['Connected apps', 'Apps conectadas', 'Apps conectados']) },
  ],
  rows: [
    // Facturación
    row('invoices', 'invoicing', ['Invoices with line items from the catalog or free text', 'Facturas con líneas del catálogo o texto libre', 'Faturas com linhas do catálogo ou texto livre'], 'have', { weight: 2 }),
    row('line-taxes', 'invoicing', ['Tax per line', 'Impuesto por línea', 'Imposto por linha'], 'have', {
      weight: 2,
      detail: [
        'Templates for Argentina (VAT 21, 10.5 and 27%), Mexico (VAT 16, 8 and 0%) and generic editable rates',
        'Plantillas para Argentina (IVA 21, 10,5 y 27 %), México (IVA 16, 8 y 0 %) y tasas genéricas editables',
        'Modelos para Argentina (IVA 21, 10,5 e 27 %), México (IVA 16, 8 e 0 %) e alíquotas genéricas editáveis',
      ],
    }),
    row('line-discounts', 'invoicing', ['Discount per line', 'Descuento por línea', 'Desconto por linha'], 'have'),
    row('multi-currency', 'invoicing', ['Multi-currency', 'Multimoneda', 'Multimoeda'], 'partial', {
      detail: [
        'Any currency with a manual exchange rate per document and exchange differences on payment; no automatic rate feed',
        'Cualquier moneda con tipo de cambio manual por documento y diferencia de cambio al cobrar; sin cotización automática',
        'Qualquer moeda com câmbio manual por documento e variação cambial no recebimento; sem cotação automática',
      ],
    }),
    row('due-dates', 'invoicing', ['Due dates and payment terms', 'Vencimientos y condiciones de pago', 'Vencimentos e condições de pagamento'], 'have'),
    row('statuses', 'invoicing', ['Statuses: draft, sent, partially paid, paid, overdue, void', 'Estados: borrador, enviada, pago parcial, pagada, vencida, anulada', 'Status: rascunho, enviada, pago parcial, paga, vencida, anulada'], 'have'),
    row('numbering', 'invoicing', ['Numbering series per point of sale', 'Numeración por punto de venta', 'Numeração por ponto de venda'], 'have', {
      detail: ['Argentina letters A, B and C by tax condition', 'Letras A, B y C de Argentina según la condición frente al IVA', 'Letras A, B e C da Argentina conforme a condição de IVA'],
    }),
    row('pdf', 'invoicing', ['Branded PDF', 'PDF con tu marca', 'PDF com sua marca'], 'have', {
      detail: ['Generated on the server with your logo, company data and footer; one layout', 'Generado en el servidor con tu logo, los datos de la empresa y el pie; un solo diseño', 'Gerado no servidor com seu logo, os dados da empresa e o rodapé; um único layout'],
    }),
    row('email-send', 'invoicing', ['Send by email with an online view link', 'Envío por email con link para verla online', 'Envio por email com link para ver online'], 'have', {
      weight: 2,
      detail: ['The link can be revoked and is hidden from search engines', 'El link se puede revocar y no lo indexan los buscadores', 'O link pode ser revogado e não é indexado'],
    }),
    row('online-payments', 'invoicing', ['Online payment from the invoice', 'Cobro online desde la factura', 'Pagamento online pela fatura'], 'have', {
      weight: 2,
      detail: [
        'Stripe Checkout and Mercado Pago with signed webhooks: each payment is recorded once, and anything above the balance is kept as a customer credit with a notice to admins',
        'Stripe Checkout y Mercado Pago con webhooks firmados: cada cobro se registra una vez y lo que supera el saldo queda como saldo a favor del cliente, con aviso a los admins',
        'Stripe Checkout e Mercado Pago com webhooks assinados: cada pagamento é registrado uma vez e o que passa do saldo fica como crédito do cliente, com aviso aos admins',
      ],
    }),
    row('recurring', 'invoicing', ['Recurring invoices', 'Facturas recurrentes', 'Faturas recorrentes'], 'have', {
      detail: ['Weekly, monthly, quarterly or yearly; each one is issued on its date and emailed if you choose', 'Semanal, mensual, trimestral o anual; cada una se emite en su fecha y se envía por email si lo elegís', 'Semanal, mensal, trimestral ou anual; cada uma é emitida na data e enviada por email se você escolher'],
    }),
    row('credit-notes', 'invoicing', ['Credit notes', 'Notas de crédito', 'Notas de crédito'], 'have'),
    row('reminders', 'invoicing', ['Automatic payment reminders', 'Recordatorios de pago automáticos', 'Lembretes de pagamento automáticos'], 'have'),
    row('quotes', 'invoicing', ['Quotes that become invoices', 'Presupuestos que pasan a factura', 'Orçamentos que viram fatura'], 'partial', {
      detail: ['Quotes are made in the CRM and turned into a Books invoice; Books has no quote editor of its own', 'Los presupuestos se hacen en el CRM y pasan a factura de Books; Books no tiene editor de presupuestos propio', 'Os orçamentos são feitos no CRM e viram fatura do Books; o Books não tem editor de orçamentos próprio'],
    }),
    row('customer-portal', 'invoicing', ['Customer portal with statements', 'Portal del cliente con estado de cuenta', 'Portal do cliente com extrato'], 'missing'),
    row('batch-payments', 'invoicing', ['Batch payments', 'Pagos por lote', 'Pagamentos em lote'], 'missing'),

    // Factura electrónica
    row('einvoice-hook', 'einvoicing', ['Electronic invoicing with the tax authority', 'Factura electrónica ante el fisco', 'Nota fiscal eletrônica junto ao fisco'], 'missing', {
      weight: 2,
      detail: [
        'Not implemented with any tax authority yet: the provider interface for ARCA (ex AFIP), SAT CFDI through a PAC and Invopop is in place, but only a test provider works (no fiscal validity)',
        'Todavía sin conexión con ningún fisco: está la interfaz de proveedor para ARCA (ex AFIP), CFDI del SAT con un PAC e Invopop, pero solo funciona un proveedor de prueba (sin validez fiscal)',
        'Ainda sem conexão com nenhum fisco: existe a interface de provedor para ARCA (ex AFIP), CFDI do SAT via PAC e Invopop, mas só funciona um provedor de teste (sem validade fiscal)',
      ],
    }),
    row('tax-filing', 'einvoicing', ['Filing tax returns', 'Presentación de declaraciones juradas', 'Entrega de declarações'], 'missing', {
      detail: ['No filing to ARCA or the SAT; the VAT report is exported as CSV', 'No presenta ante ARCA ni el SAT; el libro IVA se exporta en CSV', 'Não entrega à ARCA nem ao SAT; o livro de IVA sai em CSV'],
    }),

    // Compras y gastos
    row('bills', 'purchases', ['Supplier bills with due dates and payments', 'Facturas de proveedores con vencimiento y pagos', 'Contas de fornecedores com vencimento e pagamentos'], 'have', { weight: 2 }),
    row('receipts', 'purchases', ['Expense receipts', 'Comprobantes de gastos', 'Comprovantes de despesas'], 'have', {
      detail: [
        'Photo or PDF checked by its bytes, stored encrypted (or in a private Blob store) and opened only through Books with the right role',
        'Foto o PDF verificado por su contenido, guardado cifrado (o en un Blob privado) y que solo se abre desde Books con el rol que corresponde',
        'Foto ou PDF verificado pelo conteúdo, guardado criptografado (ou em um Blob privado) e aberto só pelo Books com o papel certo',
      ],
    }),
    row('receipt-ai', 'purchases', ['Read amount, date and vendor from a receipt', 'Leer importe, fecha y proveedor del comprobante', 'Ler valor, data e fornecedor do comprovante'], 'have', {
      detail: ['Optional, with AI from the workspace quota; the person reviews before saving', 'Opcional, con IA de la cuota del workspace; la persona revisa antes de guardar', 'Opcional, com IA da cota do workspace; a pessoa revisa antes de salvar'],
    }),
    row('categories', 'purchases', ['Expense categories', 'Categorías de gastos', 'Categorias de despesas'], 'have', {
      detail: ['The expense accounts of the chart of accounts', 'Las cuentas de gasto del plan de cuentas', 'As contas de despesa do plano de contas'],
    }),
    row('purchase-orders', 'purchases', ['Purchase orders', 'Órdenes de compra', 'Pedidos de compra'], 'have', {
      detail: ['Partial receiving and conversion to a bill', 'Recepción parcial y paso a factura de proveedor', 'Recebimento parcial e conversão em conta a pagar'],
    }),

    // Inventario
    row('items', 'inventory', ['Product and service catalog with price and cost', 'Catálogo de productos y servicios con precio y costo', 'Catálogo de produtos e serviços com preço e custo'], 'have'),
    row('stock', 'inventory', ['Tracked stock', 'Stock controlado', 'Estoque controlado'], 'partial', {
      detail: [
        'One quantity per item, raised by receiving purchase orders; no warehouses, lots or serials and no FIFO or average cost valuation',
        'Una cantidad por ítem, que sube al recibir órdenes de compra; sin depósitos, lotes ni series y sin valuación FIFO ni costo promedio',
        'Uma quantidade por item, que sobe ao receber pedidos de compra; sem depósitos, lotes ou séries e sem custo FIFO ou médio',
      ],
    }),
    row('shop-stock', 'inventory', ['Stock shared with the online store', 'Stock compartido con la tienda online', 'Estoque compartilhado com a loja online'], 'better', {
      competitorHas: false,
      detail: ['An item linked to a Shop variant uses Shop inventory instead of a copy', 'Un ítem vinculado a una variante de Shop usa el inventario de Shop, sin copiarlo', 'Um item vinculado a uma variante do Shop usa o estoque do Shop, sem copiar'],
    }),

    // Bancos
    row('bank-accounts', 'banking', ['Bank accounts', 'Cuentas bancarias', 'Contas bancárias'], 'have'),
    row('statement-import', 'banking', ['Statement import', 'Importar extractos', 'Importar extratos'], 'have', {
      weight: 2,
      detail: ['CSV and OFX, without duplicating lines already imported', 'CSV y OFX, sin duplicar las líneas ya importadas', 'CSV e OFX, sem duplicar linhas já importadas'],
    }),
    row('bank-feeds', 'banking', ['Live bank feeds', 'Conexión directa con el banco', 'Conexão direta com o banco'], 'missing', {
      weight: 2,
      detail: ['No live bank feeds; statements are imported as CSV or OFX', 'Sin conexión directa con bancos; los extractos se importan en CSV u OFX', 'Sem conexão direta com bancos; os extratos são importados em CSV ou OFX'],
    }),
    row('reconciliation', 'banking', ['Reconciliation with suggested matches', 'Conciliación con sugerencias', 'Conciliação com sugestões'], 'have', {
      weight: 2,
      detail: ['Matches invoices and bills by amount, reference and date; a line can become an expense', 'Busca facturas y compras por importe, referencia y fecha; una línea puede pasar a gasto', 'Procura faturas e contas por valor, referência e data; uma linha pode virar despesa'],
    }),
    row('bank-rules', 'banking', ['Automatic bank rules', 'Reglas bancarias automáticas', 'Regras bancárias automáticas'], 'missing'),

    // Contabilidad
    row('chart-of-accounts', 'accounting', ['Chart of accounts with country templates', 'Plan de cuentas con plantillas por país', 'Plano de contas com modelos por país'], 'have', {
      detail: ['Argentina, Mexico and generic', 'Argentina, México y genérico', 'Argentina, México e genérico'],
    }),
    row('double-entry', 'accounting', ['Automatic double-entry journals', 'Asientos de partida doble automáticos', 'Lançamentos de partida dobrada automáticos'], 'have', {
      weight: 2,
      detail: [
        'From invoices, bills, payments, expenses and credit notes; every journal balances inside one transaction and posted entries are never edited',
        'De facturas, compras, cobros, pagos, gastos y notas de crédito; cada asiento cuadra dentro de una transacción y lo contabilizado no se edita',
        'De faturas, compras, recebimentos, pagamentos, despesas e notas de crédito; cada lançamento fecha dentro de uma transação e o que foi lançado não se edita',
      ],
    }),
    row('manual-journals', 'accounting', ['Manual journals and reversals', 'Asientos manuales y reversas', 'Lançamentos manuais e estornos'], 'have'),
    row('lock-date', 'accounting', ['Period lock date', 'Cierre de período', 'Fechamento de período'], 'have'),
    row('fixed-assets', 'accounting', ['Fixed assets and depreciation', 'Bienes de uso y amortizaciones', 'Ativo imobilizado e depreciação'], 'missing'),
    row('budgets', 'accounting', ['Budgets', 'Presupuestos financieros', 'Orçamentos financeiros'], 'missing'),
    row('tracking-categories', 'accounting', ['Tracking categories', 'Centros de costo', 'Centros de custo'], 'missing'),
    row('multi-entity', 'accounting', ['Multiple companies with consolidation', 'Varias empresas con consolidación', 'Várias empresas com consolidação'], 'missing'),
    row('payroll', 'accounting', ['Payroll', 'Sueldos', 'Folha de pagamento'], 'missing'),

    // Informes
    row('profit-loss', 'reports', ['Profit and loss', 'Estado de resultados', 'Demonstração de resultados'], 'have', { weight: 2 }),
    row('balance-sheet', 'reports', ['Balance sheet', 'Balance general', 'Balanço patrimonial'], 'have', { weight: 2 }),
    row('cash-flow', 'reports', ['Cash flow', 'Flujo de fondos', 'Fluxo de caixa'], 'have', {
      detail: ['Direct method from bank and cash accounts', 'Método directo desde las cuentas de caja y bancos', 'Método direto a partir das contas de caixa e bancos'],
    }),
    row('aged-reports', 'reports', ['Aged receivables and payables', 'Antigüedad de cuentas a cobrar y a pagar', 'Idade de contas a receber e a pagar'], 'have'),
    row('tax-report', 'reports', ['Sales tax report', 'Informe de impuestos', 'Relatório de impostos'], 'have', {
      detail: ['Argentina VAT sales and purchases books, exported as CSV', 'Libro IVA ventas y compras de Argentina, exportable en CSV', 'Livro de IVA de vendas e compras da Argentina, exportável em CSV'],
    }),

    // Contactos
    row('contacts', 'contacts', ['Customers and suppliers', 'Clientes y proveedores', 'Clientes e fornecedores'], 'have'),
    row('tax-ids', 'contacts', ['Tax ID validation', 'Validación de identificación fiscal', 'Validação de identificação fiscal'], 'better', {
      detail: [
        'Check digits for CUIT, RFC, CNPJ and CPF, plus the Argentine tax condition (Responsable Inscripto, Monotributo, Consumidor Final)',
        'Dígito verificador de CUIT, RFC, CNPJ y CPF, más la condición frente al IVA (Responsable Inscripto, Monotributo, Consumidor Final)',
        'Dígito verificador de CUIT, RFC, CNPJ e CPF, mais a condição de IVA argentina (Responsable Inscripto, Monotributo, Consumidor Final)',
      ],
    }),
    row('crm-sync', 'contacts', ['Contacts shared with the CRM', 'Contactos compartidos con el CRM', 'Contatos compartilhados com o CRM'], 'better', {
      competitorHas: false,
      detail: ['Import CRM companies and keep the link', 'Importar empresas del CRM y mantener el vínculo', 'Importar empresas do CRM e manter o vínculo'],
    }),

    // Equipo y control
    row('roles', 'team', ['User roles', 'Roles de usuario', 'Papéis de usuário'], 'have', {
      detail: [
        'Accountant, sales (invoices only) and viewer (reports, the default for members), on top of per-app access',
        'Contador, ventas (solo facturas) y lectura (informes, el rol de entrada de los miembros), encima del acceso por app',
        'Contador, vendas (só faturas) e leitura (relatórios, o papel inicial dos membros), sobre o acesso por app',
      ],
    }),
    row('audit-log', 'team', ['Audit log', 'Registro de auditoría', 'Registro de auditoria'], 'have'),
    row('mobile-app', 'team', ['Mobile app', 'App móvil', 'App móvel'], 'missing'),
    row('projects-billing', 'team', ['Projects and time billing', 'Proyectos y facturación de horas', 'Projetos e faturamento de horas'], 'missing'),

    // Apps conectadas
    row('shop-orders', 'integrations', ['Online store orders post as sales', 'Los pedidos de la tienda se registran como ventas', 'Pedidos da loja entram como vendas'], 'have', {
      detail: [
        'Optional: paid Shop orders in the base currency become paid invoices with the exact order totals; Shop refunds and cancellations are recorded by hand with a credit note',
        'Opcional: los pedidos pagos de Shop en la moneda base pasan a facturas pagadas con los totales exactos del pedido; los reembolsos y cancelaciones de Shop se registran a mano con una nota de crédito',
        'Opcional: pedidos pagos do Shop na moeda base viram faturas pagas com os totais exatos do pedido; reembolsos e cancelamentos do Shop são registrados à mão com uma nota de crédito',
      ],
    }),
    row('automations', 'integrations', ['Automations on invoice events', 'Automatizaciones con eventos de facturas', 'Automações com eventos de faturas'], 'have', {
      detail: ['Flow triggers when an invoice is paid or becomes overdue', 'Flow se dispara cuando una factura se paga o vence', 'O Flow dispara quando uma fatura é paga ou vence'],
    }),
    row('assistant', 'integrations', ['AI assistant over your books', 'Asistente con IA sobre tus cuentas', 'Assistente com IA sobre suas contas'], 'have', {
      detail: ['Reads invoices and reports; drafts invoices only after you confirm', 'Lee facturas e informes; arma facturas solo después de que confirmás', 'Lê faturas e relatórios; prepara faturas só depois que você confirma'],
    }),
    row('app-marketplace', 'integrations', ['Third-party app marketplace', 'Tienda de apps de terceros', 'Loja de apps de terceiros'], 'missing'),
  ],
};

export default parity;
