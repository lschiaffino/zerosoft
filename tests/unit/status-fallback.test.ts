import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

// La base bloqueada por cuota: toda sentencia falla como falla Turso.
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: () => {
      const fail = async () => {
        throw new Error('BLOCKED: SQL read operations are forbidden (reads blocked)');
      };
      return { get: fail, all: fail, run: fail };
    },
  }),
  dbBatch: async () => {
    throw new Error('BLOCKED');
  },
  getClient: () => ({ execute: async () => Promise.reject(new Error('BLOCKED: SQL read operations are forbidden (reads blocked)')) }),
}));

describe('status: sin base', () => {
  it('el cron igual chequea y manda un email directo con los resultados', async () => {
    const mailFile = path.join(os.tmpdir(), `zerosoft-status-fallback-${process.pid}-${Date.now()}.jsonl`);
    process.env.EMAIL_CAPTURE_FILE = mailFile;
    process.env.ALERT_EMAIL = 'owner@example.com';
    delete process.env.RESEND_API_KEY;
    const { runStatusCron } = await import('@/lib/status/store');
    const { checkDatabase } = await import('@/lib/status/checks');
    const res = await runStatusCron({
      now: Date.UTC(2031, 0, 1),
      runChecks: async () => ({ database: await checkDatabase(), web: { status: 'up', ms: 1 } }),
    });
    expect(res.skipped).toBe('db_unavailable');
    expect(res.checks.database.status).toBe('down');
    const mails = fs.readFileSync(mailFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/Database unavailable/);
    expect(mails[0].text).toMatch(/database: down \(quota\/blocked/);
    fs.rmSync(mailFile, { force: true });
  });
});
