import { describe, expect, it } from 'vitest';
import { formatPhone, nameOrPhone, phoneLabel, senderLabel } from '@/components/inbox/wa/util';
import { formatWaPhone } from '@/components/groups/wa/format';

// Números inventados (ceros y 555), con la forma de cada país.
describe('teléfonos como WhatsApp Web (Lines e Inbox)', () => {
  it('formato internacional por país', () => {
    expect(formatPhone('5491100000001')).toBe('+54 9 11 0000-0001');
    expect(formatPhone('5493510000001')).toBe('+54 9 351 000-0001');
    expect(formatPhone('15550000001')).toBe('+1 555 000 0001');
    expect(formatPhone('5511900000001')).toBe('+55 11 90000-0001');
    expect(formatPhone('525500000001')).toBe('+52 55 0000 0001');
    expect(formatPhone('5215500000001')).toBe('+52 1 55 0000 0001');
    expect(formatPhone('522220000001')).toBe('+52 222 000 0001');
    expect(formatPhone('56900000001')).toBe('+56 9 0000 0001');
    expect(formatPhone('573000000001')).toBe('+57 300 0000001');
    expect(formatPhone('59890000001')).toBe('+598 90 000 001');
    expect(formatPhone('34600000001')).toBe('+34 600 00 00 01');
    expect(formatPhone('447700000001')).toBe('+44 7700 000001');
  });

  it('otro país o un largo raro: "+" y los dígitos', () => {
    expect(formatPhone('81000000001')).toBe('+81000000001');
    expect(formatPhone('+54 9 11 0000-0001')).toBe('+54 9 11 0000-0001');
    expect(formatPhone('')).toBe('');
  });

  it('un número enmascarado queda como vino', () => {
    expect(phoneLabel('54 ••• 01')).toBe('+54 ••• 01');
    expect(phoneLabel('+54 ••• 01')).toBe('+54 ••• 01');
    expect(phoneLabel('5491100000001')).toBe('+54 9 11 0000-0001');
    expect(phoneLabel('')).toBe('');
    expect(phoneLabel(null)).toBe('');
    expect(formatWaPhone('54 ••• 01', true)).toBe('54 ••• 01');
  });

  it('quien escribió en un grupo: un nombre queda, un número suelto va con formato', () => {
    expect(nameOrPhone('Ana Prueba')).toBe('Ana Prueba');
    expect(nameOrPhone('5491100000003')).toBe('+54 9 11 0000-0003');
    expect(nameOrPhone('+5491100000003')).toBe('+54 9 11 0000-0003');
    expect(nameOrPhone('+54 ••• 03')).toBe('+54 ••• 03');
    expect(nameOrPhone('Local 24')).toBe('Local 24');
    expect(senderLabel('', '5491100000003')).toBe('+54 9 11 0000-0003');
    expect(senderLabel('5491100000003', '5491100000003')).toBe('+54 9 11 0000-0003');
  });

  it('las mismas reglas en las dos apps', () => {
    for (const d of ['5491100000001', '525500000001', '34600000001']) expect(formatWaPhone(d)).toBe(formatPhone(d));
  });
});
