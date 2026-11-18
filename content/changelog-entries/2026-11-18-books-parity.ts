import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-books-parity',
  date: '2026-11-18',
  title: {
    en: 'Books: quotes, statements, batch payments, budgets and fixed assets',
    es: 'Books: presupuestos, estados de cuenta, cobros por lote, presupuestos financieros y bienes de uso',
    pt: 'Books: orçamentos, extratos, pagamentos em lote, orçamentos financeiros e ativo imobilizado',
  },
  items: [
    {
      product: 'books',
      en: 'Quotes of its own: write a quote, publish a link the customer opens without logging in to accept or decline it, and turn it into an invoice with one click.',
      es: 'Presupuestos propios: armás el presupuesto, publicás un link que el cliente abre sin iniciar sesión para aceptarlo o rechazarlo y lo pasás a factura con un clic.',
      pt: 'Orçamentos próprios: monte o orçamento, publique um link que o cliente abre sem login para aceitar ou recusar e transforme em fatura com um clique.',
    },
    {
      product: 'books',
      en: 'Statements per contact with running balance, CSV and email, and a revocable customer portal link that shows the statement and the open invoices.',
      es: 'Estado de cuenta por contacto con saldo acumulado, CSV y email, y un link de portal del cliente, revocable, con el estado de cuenta y las facturas abiertas.',
      pt: 'Extrato por contato com saldo acumulado, CSV e email, e um link de portal do cliente, revogável, com o extrato e as faturas em aberto.',
    },
    {
      product: 'books',
      en: 'Batch payments, bank rules that suggest an account and apply in bulk, and transfers between your bank accounts that both statement lines match.',
      es: 'Cobros y pagos por lote, reglas bancarias que sugieren la cuenta y se aplican en bloque, y transferencias entre tus cuentas que concilian las dos líneas del extracto.',
      pt: 'Pagamentos em lote, regras bancárias que sugerem a conta e se aplicam em bloco, e transferências entre suas contas que conciliam as duas linhas do extrato.',
    },
    {
      product: 'books',
      en: 'Prices with tax included, tracking categories on lines, budgets with a budget variance report, fixed assets with monthly depreciation and disposal, opening balances, repeating bills and a financial year setting.',
      es: 'Precios con impuesto incluido, centros de costo en las líneas, presupuestos financieros con informe contra lo real, bienes de uso con amortización mensual y baja, saldos iniciales, facturas de proveedor recurrentes y mes de arranque del ejercicio.',
      pt: 'Preços com imposto incluído, centros de custo nas linhas, orçamentos financeiros com relatório contra o realizado, ativo imobilizado com depreciação mensal e baixa, saldos iniciais, contas a pagar recorrentes e mês de início do exercício.',
    },
    {
      product: 'books',
      en: 'New reports: trial balance, general ledger, sales by item and reconciliation summary. Profit and loss and the balance sheet compare with another period, and every report exports to CSV, as do contacts, items and invoices. Contacts and items import from CSV.',
      es: 'Informes nuevos: sumas y saldos, libro mayor, ventas por ítem y resumen de conciliación. El estado de resultados y el balance se comparan con otro período, y todos los informes se exportan en CSV, igual que contactos, ítems y facturas. Contactos e ítems se importan desde CSV.',
      pt: 'Relatórios novos: balancete, razão geral, vendas por item e resumo de conciliação. A DRE e o balanço se comparam com outro período, e todos os relatórios exportam em CSV, assim como contatos, itens e faturas. Contatos e itens se importam por CSV.',
    },
    {
      product: 'books',
      en: 'Foreign currency amounts now convert exactly to the cent, and a fully paid invoice in another currency leaves receivables at zero.',
      es: 'Los importes en moneda extranjera ahora se convierten exactos al centavo, y una factura en otra moneda cobrada entera deja deudores en cero.',
      pt: 'Os valores em moeda estrangeira agora convertem exatos ao centavo, e uma fatura em outra moeda paga por inteiro deixa contas a receber em zero.',
    },
  ],
} satisfies ChangelogEntry;
