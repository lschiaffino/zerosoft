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
 * Books contra Xero (planes, docs públicos y notas de versión, 2026-11-07), con notas de
 * Argentina y México. QuickBooks, Alegra, Colppy y Odoo solo de referencia.
 * La factura electrónica queda en parcial: el gancho existe, los conectores
 * reales con ARCA y el SAT todavía no.
 */
const parity: ProductParity = {
  competitor: 'Xero',
  alsoCompared: ['QuickBooks Online', 'Alegra', 'Colppy', 'Odoo Invoicing'],
  lastReviewed: '2026-11-07',
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
    row('online-payments', 'invoicing', ['Online payment from the invoice', 'Cobro online desde la factura', 'Pagamento online pela fatura'], 'partial', {
      weight: 2,
      detail: [
        'Stripe Checkout and Mercado Pago with signed webhooks, built and tested against test doubles; not yet run against live provider accounts',
        'Stripe Checkout y Mercado Pago con webhooks firmados, hechos y probados con dobles de prueba; todavía sin correr contra cuentas reales de los proveedores',
        'Stripe Checkout e Mercado Pago com webhooks assinados, feitos e testados com dublês de teste; ainda sem rodar contra contas reais dos provedores',
      ],
    }),
    row('recurring', 'invoicing', ['Recurring invoices', 'Facturas recurrentes', 'Faturas recorrentes'], 'have', {
      detail: ['Weekly, monthly, quarterly or yearly; each one is issued on its date and emailed if you choose', 'Semanal, mensual, trimestral o anual; cada una se emite en su fecha y se envía por email si lo elegís', 'Semanal, mensal, trimestral ou anual; cada uma é emitida na data e enviada por email se você escolher'],
    }),
    row('credit-notes', 'invoicing', ['Credit notes', 'Notas de crédito', 'Notas de crédito'], 'have'),
    row('reminders', 'invoicing', ['Automatic payment reminders', 'Recordatorios de pago automáticos', 'Lembretes de pagamento automáticos'], 'have'),
    row('quotes', 'invoicing', ['Quotes the customer accepts online and that become invoices', 'Presupuestos que el cliente acepta online y pasan a factura', 'Orçamentos que o cliente aceita online e viram fatura'], 'have', {
      detail: [
        'Own quote editor with numbering, expiry, a link to accept or decline without login, and conversion to an invoice once; CRM quotes can also be invoiced',
        'Editor propio con numeración, vencimiento, link para aceptar o rechazar sin login y paso a factura una sola vez; los presupuestos del CRM también se facturan',
        'Editor próprio com numeração, validade, link para aceitar ou recusar sem login e conversão em fatura uma única vez; orçamentos do CRM também viram fatura',
      ],
    }),
    row('customer-portal', 'invoicing', ['Customer statements and portal', 'Estado de cuenta y portal del cliente', 'Extrato e portal do cliente'], 'have', {
      detail: [
        'Statement per contact and currency with running balance, CSV and email; a revocable link where the customer sees it and opens open invoices to pay',
        'Estado de cuenta por contacto y moneda con saldo acumulado, CSV y email; un link revocable donde el cliente lo ve y abre sus facturas para pagarlas',
        'Extrato por contato e moeda com saldo acumulado, CSV e email; um link revogável onde o cliente o vê e abre as faturas para pagar',
      ],
    }),
    row('batch-payments', 'invoicing', ['Batch payments', 'Pagos por lote', 'Pagamentos em lote'], 'have', {
      detail: ['Several invoices or bills in one entry and one bank line, all or nothing; the statement line matches the whole batch', 'Varias facturas en un asiento y una línea de banco, todo o nada; la línea del extracto concilia contra el lote', 'Várias faturas em um lançamento e uma linha bancária, tudo ou nada; a linha do extrato concilia com o lote'],
    }),
    row('tax-inclusive', 'invoicing', ['Prices that include tax', 'Precios con impuesto incluido', 'Preços com imposto incluído'], 'have', {
      detail: ['Per document, on invoices, bills, credit notes and quotes; tax is taken out of each line to the cent', 'Por documento, en facturas, compras, notas de crédito y presupuestos; el impuesto se saca de cada línea al centavo', 'Por documento, em faturas, contas, notas de crédito e orçamentos; o imposto é extraído de cada linha ao centavo'],
    }),
    row('credit-allocation', 'invoicing', ['Allocate credit notes and overpayments to other invoices', 'Aplicar notas de crédito y saldos a favor a otras facturas', 'Aplicar notas de crédito e créditos a outras faturas'], 'missing', {
      detail: ['A credit note applies to its own invoice; what is left stays as a customer credit', 'Una nota de crédito se aplica a su factura; lo que sobra queda como saldo a favor', 'Uma nota de crédito se aplica à sua fatura; o que sobra fica como crédito'],
    }),
    row('scheduled-send', 'invoicing', ['Scheduled invoice sending', 'Envío programado de facturas', 'Envio agendado de faturas'], 'missing'),

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
    row('repeating-bills', 'purchases', ['Repeating bills', 'Facturas de proveedor recurrentes', 'Contas a pagar recorrentes'], 'have'),
    row('expense-claims', 'purchases', ['Employee expense claims', 'Rendición de gastos de empleados', 'Reembolso de despesas de funcionários'], 'missing'),
    row('attachments', 'purchases', ['Files attached to invoices and bills', 'Archivos adjuntos en facturas y compras', 'Anexos em faturas e contas'], 'missing', {
      detail: ['Receipts attach to expenses only', 'Los comprobantes se adjuntan solo a gastos', 'Os comprovantes se anexam só a despesas'],
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
    row('bank-rules', 'banking', ['Bank rules', 'Reglas bancarias', 'Regras bancárias'], 'have', {
      detail: [
        'By text, direction, amount range and account; they suggest per line and apply in bulk. Rules record no tax',
        'Por texto, sentido, rango de importe y cuenta; sugieren en cada línea y se aplican en bloque. Las reglas no registran impuesto',
        'Por texto, sentido, faixa de valor e conta; sugerem em cada linha e se aplicam em bloco. As regras não lançam imposto',
      ],
    }),
    row('bank-transfers', 'banking', ['Transfers between bank accounts', 'Transferencias entre cuentas', 'Transferências entre contas'], 'have', {
      detail: ['One entry that both statement lines match without posting twice', 'Un asiento al que concilian las dos líneas de extracto sin duplicarlo', 'Um lançamento que as duas linhas de extrato conciliam sem duplicar'],
    }),
    row('foreign-bank-accounts', 'banking', ['Bank accounts in a foreign currency', 'Cuentas bancarias en moneda extranjera', 'Contas bancárias em moeda estrangeira'], 'missing', {
      detail: ['Bank accounts use the base currency', 'Las cuentas bancarias usan la moneda base', 'As contas bancárias usam a moeda base'],
    }),

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
    row('lock-date', 'accounting', ['Period lock date', 'Cierre de período', 'Fechamento de período'], 'have', {
      detail: ['Nothing posts, is paid, deleted or depreciated on or before the lock date; voids reverse with today’s date', 'Nada se registra, cobra, borra ni amortiza hasta la fecha de cierre; las anulaciones revierten con la fecha de hoy', 'Nada é lançado, pago, excluído ou depreciado até a data de fechamento; cancelamentos estornam com a data de hoje'],
    }),
    row('financial-year', 'accounting', ['Financial year with automatic year-end', 'Ejercicio con cierre anual automático', 'Exercício com encerramento automático'], 'have'),
    row('opening-balances', 'accounting', ['Opening (conversion) balances', 'Saldos iniciales', 'Saldos iniciais'], 'have'),
    row('repeating-journals', 'accounting', ['Repeating manual journals', 'Asientos manuales recurrentes', 'Lançamentos manuais recorrentes'], 'missing'),
    row('find-recode', 'accounting', ['Find and recode posted transactions', 'Buscar y recodificar movimientos registrados', 'Localizar e recodificar lançamentos'], 'missing', {
      detail: ['Posted entries are corrected with a reversal', 'Lo registrado se corrige con una reversa', 'O que foi lançado se corrige com um estorno'],
    }),
    row('fx-revaluation', 'accounting', ['Unrealised currency gains', 'Diferencia de cambio no realizada', 'Variação cambial não realizada'], 'missing', {
      detail: ['Exchange differences are recorded when payments are made', 'La diferencia de cambio se registra al cobrar o pagar', 'A variação cambial é lançada no recebimento ou pagamento'],
    }),
    row('fixed-assets', 'accounting', ['Fixed assets and depreciation', 'Bienes de uso y amortizaciones', 'Ativo imobilizado e depreciação'], 'have', {
      detail: [
        'Straight line or declining balance, monthly run with rollback and disposal with gain or loss; one depreciation book, no asset types',
        'Lineal o saldo decreciente, corrida mensual con vuelta atrás y baja con resultado; un solo libro de amortización, sin tipos de bien',
        'Linear ou saldo decrescente, rodada mensal com desfazer e baixa com resultado; um só livro de depreciação, sem tipos de bem',
      ],
    }),
    row('budgets', 'accounting', ['Budgets and budget variance', 'Presupuestos financieros y desvío', 'Orçamentos financeiros e desvio'], 'have', {
      detail: ['Monthly by income and expense account, compared with actual in a report', 'Mensuales por cuenta de ingreso y gasto, comparados con lo real en un informe', 'Mensais por conta de receita e despesa, comparados com o realizado em um relatório'],
    }),
    row('tracking-categories', 'accounting', ['Tracking categories', 'Centros de costo', 'Centros de custo'], 'partial', {
      detail: [
        'Two categories on invoice, bill, credit note and manual journal lines, with profit and loss by option; not yet on expenses or bank rules',
        'Dos categorías en líneas de facturas, compras, notas de crédito y asientos manuales, con resultados por opción; todavía no en gastos ni reglas bancarias',
        'Duas categorias em linhas de faturas, contas, notas de crédito e lançamentos manuais, com resultados por opção; ainda não em despesas nem regras bancárias',
      ],
    }),
    row('multi-entity', 'accounting', ['Multiple companies with consolidation', 'Varias empresas con consolidación', 'Várias empresas com consolidação'], 'missing'),
    row('payroll', 'accounting', ['Payroll', 'Sueldos', 'Folha de pagamento'], 'missing'),

    // Informes
    row('profit-loss', 'reports', ['Profit and loss', 'Estado de resultados', 'Demonstração de resultados'], 'have', { weight: 2 }),
    row('balance-sheet', 'reports', ['Balance sheet', 'Balance general', 'Balanço patrimonial'], 'have', { weight: 2 }),
    row('cash-flow', 'reports', ['Cash flow', 'Flujo de fondos', 'Fluxo de caixa'], 'have', {
      detail: ['Direct method from bank and cash accounts', 'Método directo desde las cuentas de caja y bancos', 'Método direto a partir das contas de caixa e bancos'],
    }),
    row('aged-reports', 'reports', ['Aged receivables and payables', 'Antigüedad de cuentas a cobrar y a pagar', 'Idade de contas a receber e a pagar'], 'have'),
    row('trial-balance', 'reports', ['Trial balance', 'Balance de sumas y saldos', 'Balancete'], 'have'),
    row('general-ledger', 'reports', ['General ledger with running balances', 'Libro mayor con saldo acumulado', 'Razão geral com saldo acumulado'], 'have'),
    row('sales-by-item', 'reports', ['Sales by item', 'Ventas por ítem', 'Vendas por item'], 'have'),
    row('reconciliation-report', 'reports', ['Bank reconciliation summary', 'Resumen de conciliación bancaria', 'Resumo de conciliação bancária'], 'have'),
    row('report-compare', 'reports', ['Comparison periods', 'Comparación de períodos', 'Comparação de períodos'], 'partial', {
      detail: ['One comparison column: previous period or same period last year', 'Una columna de comparación: período anterior o mismo período del año pasado', 'Uma coluna de comparação: período anterior ou mesmo período do ano passado'],
    }),
    row('report-export', 'reports', ['Export reports', 'Exportar informes', 'Exportar relatórios'], 'partial', {
      detail: ['CSV for every report; no PDF or spreadsheet export', 'CSV en todos los informes; sin exportar a PDF ni planilla', 'CSV em todos os relatórios; sem exportar para PDF ou planilha'],
    }),
    row('cash-forecast', 'reports', ['Short-term cash flow forecast', 'Proyección de caja a corto plazo', 'Projeção de caixa de curto prazo'], 'missing'),
    row('tax-report', 'reports', ['Sales tax report', 'Informe de impuestos', 'Relatório de impostos'], 'have', {
      detail: ['Argentina VAT sales and purchases books, exported as CSV', 'Libro IVA ventas y compras de Argentina, exportable en CSV', 'Livro de IVA de vendas e compras da Argentina, exportável em CSV'],
    }),

    // Contactos
    row('contacts', 'contacts', ['Customers and suppliers', 'Clientes y proveedores', 'Clientes e fornecedores'], 'have', {
      detail: ['Import and export as CSV', 'Se importan y exportan en CSV', 'Importação e exportação em CSV'],
    }),
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
