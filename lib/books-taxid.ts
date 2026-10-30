/**
 * Books: identificaciones fiscales de la región con su dígito verificador
 * (puro). CUIT/CUIL (AR), RFC (MX), CNPJ y CPF (BR). Para el resto de los
 * países solo se limpia el texto: no inventamos validaciones.
 */

export type TaxIdType = 'cuit' | 'rfc' | 'cnpj' | 'cpf' | 'other';

export const TAX_ID_TYPES: readonly TaxIdType[] = ['cuit', 'rfc', 'cnpj', 'cpf', 'other'];

/** Condiciones frente al IVA de Argentina (ARCA, ex AFIP). */
export const AR_TAX_CONDITIONS = ['ri', 'monotributo', 'cf', 'exento', 'no_responsable'] as const;
export type ArTaxCondition = (typeof AR_TAX_CONDITIONS)[number];

const digits = (s: string) => s.replace(/\D/g, '');

/** CUIT/CUIL: 11 dígitos, prefijo conocido, módulo 11 con pesos 5432765432. */
export function isValidCuit(input: string): boolean {
  const d = digits(input);
  if (d.length !== 11) return false;
  if (!['20', '23', '24', '25', '26', '27', '30', '33', '34'].includes(d.slice(0, 2))) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === Number(d[10]);
}

/** "20123456786" → "20-12345678-6". */
export function formatCuit(input: string): string {
  const d = digits(input);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : input.trim();
}

const RFC_CHARS = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

/**
 * RFC (SAT): 12 caracteres (moral) o 13 (física): letras, fecha AAMMDD
 * válida, homoclave y dígito verificador (módulo 11 sobre la tabla del SAT).
 * Los genéricos XAXX010101000 y XEXX010101000 son válidos.
 */
export function isValidRfc(input: string): boolean {
  const rfc = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (rfc === 'XAXX010101000' || rfc === 'XEXX010101000') return true;
  const m = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z\d]{2})([A\d])$/.exec(rfc);
  if (!m) return false;
  const [, , yy, mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const year = 2000 + Number(yy);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) {
    // 29 de febrero en un año no bisiesto del siglo 2000: probar con 1900.
    if (new Date(Date.UTC(1900 + Number(yy), month - 1, day)).getUTCMonth() !== month - 1) return false;
  }
  const padded = rfc.length === 12 ? ` ${rfc}` : rfc;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = RFC_CHARS.indexOf(padded[i]);
    if (v < 0) return false;
    sum += v * (13 - i);
  }
  const rest = sum % 11;
  const expected = rest === 0 ? '0' : rest === 1 ? 'A' : String(11 - rest);
  return expected === rfc[rfc.length - 1];
}

function allSame(d: string): boolean {
  return /^(\d)\1+$/.test(d);
}

/** CNPJ: 14 dígitos con dos verificadores (módulo 11). */
export function isValidCnpj(input: string): boolean {
  const d = digits(input);
  if (d.length !== 14 || allSame(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** CPF: 11 dígitos con dos verificadores. */
export function isValidCpf(input: string): boolean {
  const d = digits(input);
  if (d.length !== 11 || allSame(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Tipo de identificación esperado según el país. */
export function taxIdTypeFor(country: string): TaxIdType {
  switch (country.toUpperCase()) {
    case 'AR':
      return 'cuit';
    case 'MX':
      return 'rfc';
    case 'BR':
      return 'cnpj';
    default:
      return 'other';
  }
}

export function validateTaxId(type: TaxIdType | string, value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  switch (type) {
    case 'cuit':
      return isValidCuit(v);
    case 'rfc':
      return isValidRfc(v);
    case 'cnpj':
      return isValidCnpj(v);
    case 'cpf':
      return isValidCpf(v);
    default:
      return v.length <= 40;
  }
}

/** Forma canónica para guardar (CUIT con guiones, RFC en mayúsculas, CNPJ/CPF solo dígitos). */
export function normalizeTaxId(type: TaxIdType | string, value: string): string {
  const v = value.trim();
  if (!v) return '';
  switch (type) {
    case 'cuit':
      return formatCuit(v);
    case 'rfc':
      return v.toUpperCase().replace(/[\s-]/g, '');
    case 'cnpj':
    case 'cpf':
      return digits(v);
    default:
      return v.slice(0, 40);
  }
}

/**
 * Letra del comprobante en Argentina según emisor y receptor: un Responsable
 * Inscripto le factura "A" a otro RI y "B" al resto; un Monotributista o
 * Exento siempre "C".
 */
export function arInvoiceLetter(issuer: string, receiver: string): 'A' | 'B' | 'C' {
  if (issuer !== 'ri') return 'C';
  return receiver === 'ri' ? 'A' : 'B';
}
