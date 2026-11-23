import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDb, upsertUser } from '@/lib/db';
import { ensureWorkspace } from '@/lib/workspace';
import { bulkSend, createTemplate, setTemplateDocument, updateTemplate } from '@/lib/sign/templates';
import { bulkColumns, bulkHeaderFor, csvLine, normalizeHeader } from '@/lib/sign/bulk-csv';
import { parseCsv } from '@/lib/csv-parse';
import type { SignActor } from '@/lib/sign/types';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-sign-bulk-uploads-${process.pid}`);

const uid = () => Math.random().toString(36).slice(2, 10);

const ROLES = [
  { key: 'client', name: 'Client', role: 'signer' },
  { key: 'mgr', name: 'Account Manager', role: 'signer' },
  { key: 'legal', name: 'Legal', role: 'cc' },
];

describe('Sign: columnas del CSV masivo', () => {
  it('normaliza encabezados: mayúsculas, guiones, puntos y BOM', () => {
    expect(normalizeHeader('﻿ Account_Manager.Email ')).toBe('account manager email');
    expect(normalizeHeader('Client-Name')).toBe('client name');
  });

  it('name y email van al primer firmante; <rol> name/email a cada rol', () => {
    const c = bulkColumns(ROLES, ['name', 'email', 'Account Manager name', 'account_manager_email', 'title']);
    expect(c.roles).toEqual({ client: { name: 0, email: 1 }, mgr: { name: 2, email: 3 } });
    expect(c.title).toBe(4);
    expect(c.message).toBe(-1);
    expect(c.incomplete).toEqual([]);
  });

  it('las columnas propias del primer firmante ganan a name/email', () => {
    const c = bulkColumns(ROLES, ['Client name', 'Client email', 'name', 'email']);
    expect(c.roles.client).toEqual({ name: 0, email: 1 });
  });

  it('un rol con una sola de las dos columnas queda incompleto', () => {
    expect(bulkColumns(ROLES, ['name', 'email', 'Legal email']).incomplete).toEqual(['Legal']);
  });

  it('el encabezado con todos los roles se lee de vuelta igual', () => {
    const header = bulkHeaderFor(ROLES);
    expect(header).toBe('Client name,Client email,Account Manager name,Account Manager email,Legal name,Legal email');
    expect(Object.keys(bulkColumns(ROLES, parseCsv(header)[0]).roles)).toEqual(['client', 'mgr', 'legal']);
  });

  it('csvLine respeta comas, comillas y saltos de línea', () => {
    const cells = ['Ana, Jr.', 'say "hi"', 'line 1\nline 2'];
    expect(parseCsv(csvLine(cells))[0]).toEqual(cells);
  });
});

describe('Sign: envío masivo con varios roles', () => {
  let owner: SignActor;
  let tplId = '';
  beforeAll(async () => {
    const email = `sg-bulk-${uid()}@example.com`;
    const o = await upsertUser({ email, name: 'Owner', image: null });
    await ensureWorkspace(o.id);
    owner = { ws: o.id, person: o.id, admin: true, email, name: 'Owner' };
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText('Agreement', { x: 50, y: 700 });
    const tp = await createTemplate(owner, { name: `Agreement ${uid()}` });
    tplId = tp.id;
    await setTemplateDocument(owner, tp.id, { bytes: Buffer.from(await doc.save()), name: 'agreement.pdf' });
    await updateTemplate(owner, tp.id, {
      roles: [
        { key: 'client', name: 'Client', role: 'signer', order: 1 },
        { key: 'mgr', name: 'Manager', role: 'signer', order: 2 },
        { key: 'legal', name: 'Legal', role: 'cc', order: 3 },
      ],
      fields: [
        { roleKey: 'client', kind: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
        { roleKey: 'mgr', kind: 'signature', page: 1, x: 0.6, y: 0.8, w: 0.3, h: 0.06 },
      ],
    });
  });

  const recipientsOf = async (envId: string) =>
    (await getDb().prepare('SELECT role_name, name, email FROM sign_recipients WHERE envelope_id = ? ORDER BY routing_order, role_name').all(envId)) as Array<{ role_name: string; name: string; email: string }>;

  it('cada fila completa cliente y manager; legal va fijo; title y message por fila', async () => {
    const tag = uid();
    const csv = [
      'Client name,Client email,Manager name,Manager email,title,message',
      `Ana,ana-${tag}@example.com,Marta,marta-${tag}@example.com,Lease for Ana,"Hi Ana,\nplease sign."`,
      `Bruno,bruno-${tag}@example.com,Mario,mario-${tag}@example.com,,`,
      `Carla,carla-${tag}@example.com,,,,`,
    ].join('\n');
    const res = await bulkSend(owner, tplId, { csv, fixed: { legal: { name: 'Legal Team', email: `legal-${tag}@example.com` } } });
    expect(res.sent).toBe(2);
    expect(res.errors).toEqual([{ row: 4, error: 'invalid_row' }]);
    const envs = (await getDb().prepare('SELECT id, title, message FROM sign_envelopes WHERE bulk_id = ? ORDER BY bulk_key').all(res.bulkId)) as Array<{ id: string; title: string; message: string }>;
    expect(envs).toHaveLength(2);
    expect(envs[0].title).toBe('Lease for Ana');
    expect(envs[0].message).toBe('Hi Ana,\nplease sign.');
    expect(envs[1].title).toMatch(/ · Bruno$/);
    const ana = await recipientsOf(envs[0].id);
    expect(ana.map((r) => [r.role_name, r.email])).toEqual([
      ['Client', `ana-${tag}@example.com`],
      ['Manager', `marta-${tag}@example.com`],
      ['Legal', `legal-${tag}@example.com`],
    ]);
  });

  it('un rol sin columnas y sin valor fijo corta antes de crear nada', async () => {
    const csv = `name,email\nAna,ana-${uid()}@example.com\n`;
    await expect(bulkSend(owner, tplId, { csv, fixed: { legal: { name: 'L', email: 'l@example.com' } } })).rejects.toMatchObject({ code: 'role_unfilled', detail: { role: 'Manager' } });
  });

  it('una columna de rol suelta es csv_role_incomplete; sin columnas de nadie es csv_header', async () => {
    await expect(bulkSend(owner, tplId, { csv: 'name,email,Manager email\nA,a@example.com,m@example.com\n' })).rejects.toMatchObject({ code: 'csv_role_incomplete' });
    await expect(bulkSend(owner, tplId, { csv: 'who,where\nA,B\n' })).rejects.toMatchObject({ code: 'csv_header' });
  });

  it('el formato viejo (name, email y el resto fijo) sigue andando', async () => {
    const tag = uid();
    const res = await bulkSend(owner, tplId, {
      csv: `name,email\nDora,dora-${tag}@example.com\n`,
      fixed: { mgr: { name: 'Mgr', email: `mgr-${tag}@example.com` }, legal: { name: 'L', email: `l-${tag}@example.com` } },
    });
    expect(res.sent).toBe(1);
  });
});
