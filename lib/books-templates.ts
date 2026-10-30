/**
 * Books: plantillas de plan de cuentas e impuestos por país (puro).
 *
 * Las cuentas con `key` son las que usa la contabilidad automática
 * (deudores, proveedores, IVA, ventas...). Se pueden renombrar y recodificar,
 * pero no borrar. El resto es un punto de partida editable.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export const ACCOUNT_TYPES: readonly AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export type AccountSubtype = 'bank' | 'cash' | 'receivable' | 'payable' | 'tax' | 'inventory' | 'current' | 'fixed' | 'equity' | 'sales' | 'other_income' | 'cogs' | 'expense' | 'other';

/** Claves de sistema: cuentas que los asientos automáticos necesitan. */
export type SystemKey =
  | 'cash'
  | 'bank'
  | 'ar'
  | 'clearing'
  | 'inventory'
  | 'tax_in'
  | 'ap'
  | 'tax_out'
  | 'equity'
  | 'retained'
  | 'sales'
  | 'services'
  | 'shipping_income'
  | 'fx'
  | 'cogs'
  | 'expense'
  | 'bank_fees';

export const SYSTEM_KEYS: readonly SystemKey[] = ['cash', 'bank', 'ar', 'clearing', 'inventory', 'tax_in', 'ap', 'tax_out', 'equity', 'retained', 'sales', 'services', 'shipping_income', 'fx', 'cogs', 'expense', 'bank_fees'];

export interface AccountTemplate {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  key?: SystemKey;
}

export type BooksCountry = 'AR' | 'MX' | 'generic';
export const BOOKS_COUNTRIES: readonly BooksCountry[] = ['AR', 'MX', 'generic'];

const GENERIC: AccountTemplate[] = [
  { code: '1000', name: 'Cash', type: 'asset', subtype: 'cash', key: 'cash' },
  { code: '1010', name: 'Bank', type: 'asset', subtype: 'bank', key: 'bank' },
  { code: '1100', name: 'Accounts receivable', type: 'asset', subtype: 'receivable', key: 'ar' },
  { code: '1150', name: 'Payments in transit (Stripe, Mercado Pago)', type: 'asset', subtype: 'current', key: 'clearing' },
  { code: '1200', name: 'Inventory', type: 'asset', subtype: 'inventory', key: 'inventory' },
  { code: '1300', name: 'Sales tax receivable', type: 'asset', subtype: 'tax', key: 'tax_in' },
  { code: '1500', name: 'Equipment', type: 'asset', subtype: 'fixed' },
  { code: '2000', name: 'Accounts payable', type: 'liability', subtype: 'payable', key: 'ap' },
  { code: '2100', name: 'Sales tax payable', type: 'liability', subtype: 'tax', key: 'tax_out' },
  { code: '2200', name: 'Loans', type: 'liability', subtype: 'other' },
  { code: '3000', name: "Owner's equity", type: 'equity', subtype: 'equity', key: 'equity' },
  { code: '3100', name: 'Retained earnings', type: 'equity', subtype: 'equity', key: 'retained' },
  { code: '4000', name: 'Sales', type: 'income', subtype: 'sales', key: 'sales' },
  { code: '4100', name: 'Services', type: 'income', subtype: 'sales', key: 'services' },
  { code: '4200', name: 'Shipping income', type: 'income', subtype: 'sales', key: 'shipping_income' },
  { code: '4900', name: 'Exchange differences', type: 'income', subtype: 'other_income', key: 'fx' },
  { code: '5000', name: 'Cost of goods sold', type: 'expense', subtype: 'cogs', key: 'cogs' },
  { code: '6000', name: 'Rent', type: 'expense', subtype: 'expense' },
  { code: '6100', name: 'Salaries', type: 'expense', subtype: 'expense' },
  { code: '6200', name: 'Software and subscriptions', type: 'expense', subtype: 'expense' },
  { code: '6300', name: 'Office supplies', type: 'expense', subtype: 'expense' },
  { code: '6400', name: 'Travel and meals', type: 'expense', subtype: 'expense' },
  { code: '6500', name: 'Bank and payment fees', type: 'expense', subtype: 'expense', key: 'bank_fees' },
  { code: '6600', name: 'Marketing', type: 'expense', subtype: 'expense' },
  { code: '6700', name: 'Professional services', type: 'expense', subtype: 'expense' },
  { code: '6800', name: 'Utilities', type: 'expense', subtype: 'expense' },
  { code: '6900', name: 'Other expenses', type: 'expense', subtype: 'expense', key: 'expense' },
];

/** Argentina: nombres del plan de cuentas modelo (FACPCE simplificado). */
const AR: AccountTemplate[] = [
  { code: '1.1.01', name: 'Caja', type: 'asset', subtype: 'cash', key: 'cash' },
  { code: '1.1.02', name: 'Banco cuenta corriente', type: 'asset', subtype: 'bank', key: 'bank' },
  { code: '1.1.03', name: 'Deudores por ventas', type: 'asset', subtype: 'receivable', key: 'ar' },
  { code: '1.1.04', name: 'Cobros a acreditar (Mercado Pago, Stripe)', type: 'asset', subtype: 'current', key: 'clearing' },
  { code: '1.1.05', name: 'IVA crédito fiscal', type: 'asset', subtype: 'tax', key: 'tax_in' },
  { code: '1.1.06', name: 'Retenciones y percepciones sufridas', type: 'asset', subtype: 'tax' },
  { code: '1.1.07', name: 'Mercaderías', type: 'asset', subtype: 'inventory', key: 'inventory' },
  { code: '1.2.01', name: 'Bienes de uso', type: 'asset', subtype: 'fixed' },
  { code: '2.1.01', name: 'Proveedores', type: 'liability', subtype: 'payable', key: 'ap' },
  { code: '2.1.02', name: 'IVA débito fiscal', type: 'liability', subtype: 'tax', key: 'tax_out' },
  { code: '2.1.03', name: 'Ingresos brutos a pagar', type: 'liability', subtype: 'tax' },
  { code: '2.1.04', name: 'Sueldos y cargas sociales a pagar', type: 'liability', subtype: 'other' },
  { code: '3.1.01', name: 'Capital social', type: 'equity', subtype: 'equity', key: 'equity' },
  { code: '3.2.01', name: 'Resultados no asignados', type: 'equity', subtype: 'equity', key: 'retained' },
  { code: '4.1.01', name: 'Ventas de mercaderías', type: 'income', subtype: 'sales', key: 'sales' },
  { code: '4.1.02', name: 'Ventas de servicios', type: 'income', subtype: 'sales', key: 'services' },
  { code: '4.1.03', name: 'Ingresos por envíos', type: 'income', subtype: 'sales', key: 'shipping_income' },
  { code: '4.2.01', name: 'Diferencias de cambio', type: 'income', subtype: 'other_income', key: 'fx' },
  { code: '5.1.01', name: 'Costo de mercaderías vendidas', type: 'expense', subtype: 'cogs', key: 'cogs' },
  { code: '5.2.01', name: 'Alquileres', type: 'expense', subtype: 'expense' },
  { code: '5.2.02', name: 'Sueldos y jornales', type: 'expense', subtype: 'expense' },
  { code: '5.2.03', name: 'Honorarios profesionales', type: 'expense', subtype: 'expense' },
  { code: '5.2.04', name: 'Servicios (luz, gas, internet)', type: 'expense', subtype: 'expense' },
  { code: '5.2.05', name: 'Software y suscripciones', type: 'expense', subtype: 'expense' },
  { code: '5.2.06', name: 'Publicidad', type: 'expense', subtype: 'expense' },
  { code: '5.2.07', name: 'Gastos y comisiones bancarias', type: 'expense', subtype: 'expense', key: 'bank_fees' },
  { code: '5.2.08', name: 'Impuesto a los débitos y créditos', type: 'expense', subtype: 'expense' },
  { code: '5.2.09', name: 'Movilidad y viáticos', type: 'expense', subtype: 'expense' },
  { code: '5.2.99', name: 'Gastos varios', type: 'expense', subtype: 'expense', key: 'expense' },
];

/** México: agrupado como el código agrupador del SAT (simplificado). */
const MX: AccountTemplate[] = [
  { code: '101', name: 'Caja', type: 'asset', subtype: 'cash', key: 'cash' },
  { code: '102', name: 'Bancos', type: 'asset', subtype: 'bank', key: 'bank' },
  { code: '105', name: 'Clientes', type: 'asset', subtype: 'receivable', key: 'ar' },
  { code: '106', name: 'Cobros por acreditar (Stripe, Mercado Pago)', type: 'asset', subtype: 'current', key: 'clearing' },
  { code: '115', name: 'Inventario', type: 'asset', subtype: 'inventory', key: 'inventory' },
  { code: '118', name: 'IVA acreditable', type: 'asset', subtype: 'tax', key: 'tax_in' },
  { code: '151', name: 'Mobiliario y equipo', type: 'asset', subtype: 'fixed' },
  { code: '201', name: 'Proveedores', type: 'liability', subtype: 'payable', key: 'ap' },
  { code: '208', name: 'IVA trasladado', type: 'liability', subtype: 'tax', key: 'tax_out' },
  { code: '213', name: 'Impuestos y derechos por pagar', type: 'liability', subtype: 'tax' },
  { code: '301', name: 'Capital social', type: 'equity', subtype: 'equity', key: 'equity' },
  { code: '304', name: 'Resultados de ejercicios anteriores', type: 'equity', subtype: 'equity', key: 'retained' },
  { code: '401', name: 'Ventas', type: 'income', subtype: 'sales', key: 'sales' },
  { code: '402', name: 'Servicios', type: 'income', subtype: 'sales', key: 'services' },
  { code: '403', name: 'Ingresos por envíos', type: 'income', subtype: 'sales', key: 'shipping_income' },
  { code: '702', name: 'Utilidad o pérdida cambiaria', type: 'income', subtype: 'other_income', key: 'fx' },
  { code: '501', name: 'Costo de venta', type: 'expense', subtype: 'cogs', key: 'cogs' },
  { code: '601', name: 'Renta', type: 'expense', subtype: 'expense' },
  { code: '602', name: 'Sueldos y salarios', type: 'expense', subtype: 'expense' },
  { code: '603', name: 'Honorarios', type: 'expense', subtype: 'expense' },
  { code: '604', name: 'Software y suscripciones', type: 'expense', subtype: 'expense' },
  { code: '605', name: 'Publicidad', type: 'expense', subtype: 'expense' },
  { code: '606', name: 'Comisiones bancarias', type: 'expense', subtype: 'expense', key: 'bank_fees' },
  { code: '607', name: 'Viáticos', type: 'expense', subtype: 'expense' },
  { code: '699', name: 'Otros gastos', type: 'expense', subtype: 'expense', key: 'expense' },
];

export function accountTemplate(country: BooksCountry): AccountTemplate[] {
  return country === 'AR' ? AR : country === 'MX' ? MX : GENERIC;
}

export interface TaxTemplate {
  name: string;
  code: string;
  rateBps: number;
  isDefault?: boolean;
}

/**
 * Tasas por país. AR: IVA 21 %, 10,5 % y 27 %, exento y no gravado. MX: IVA
 * 16 %, 8 % (región fronteriza) y 0 %, exento. Genérico: tasas comunes sin
 * nombre de impuesto (sirven para el ICMS u otro: se editan).
 */
export function taxTemplate(country: BooksCountry): TaxTemplate[] {
  if (country === 'AR')
    return [
      { name: 'IVA 21%', code: 'IVA21', rateBps: 2100, isDefault: true },
      { name: 'IVA 10,5%', code: 'IVA105', rateBps: 1050 },
      { name: 'IVA 27%', code: 'IVA27', rateBps: 2700 },
      { name: 'IVA 0% (exento)', code: 'EXENTO', rateBps: 0 },
      { name: 'No gravado', code: 'NOGRAV', rateBps: 0 },
    ];
  if (country === 'MX')
    return [
      { name: 'IVA 16%', code: 'IVA16', rateBps: 1600, isDefault: true },
      { name: 'IVA 8% (frontera)', code: 'IVA8', rateBps: 800 },
      { name: 'IVA 0%', code: 'IVA0', rateBps: 0 },
      { name: 'Exento', code: 'EXENTO', rateBps: 0 },
    ];
  return [
    { name: 'No tax', code: 'NONE', rateBps: 0 },
    { name: 'Tax 5%', code: 'T5', rateBps: 500 },
    { name: 'Tax 10%', code: 'T10', rateBps: 1000 },
    { name: 'Tax 18%', code: 'T18', rateBps: 1800 },
    { name: 'Tax 20%', code: 'T20', rateBps: 2000, isDefault: true },
  ];
}

/** Moneda base sugerida por país. */
export function defaultCurrency(country: BooksCountry): string {
  return country === 'AR' ? 'ARS' : country === 'MX' ? 'MXN' : 'USD';
}

/** Saldo "normal" de cada tipo: activos y gastos al debe, el resto al haber. */
export function normalSide(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}
