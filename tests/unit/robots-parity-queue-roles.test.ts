import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  cancelQueuedRun,
  cancelRobotBatch,
  createRobot,
  createRobotRecording,
  deleteRobotRecording,
  drainRobotQueue,
  enqueueRobotBatch,
  getRobot,
  getRobotBatch,
  getRobotRecording,
  getRobotRow,
  getRobotWorkspaceConfig,
  listRobotBatches,
  neutralizeRecorded,
  approveSuggestedSelector,
  syncPausedBatchNotices,
  pushRobotRecording,
  setRobotWorkspaceConfig,
  startRobotRun,
  updateRobot,
} from '@/lib/robots';
import { noticeRecipient } from '@/lib/robots-alerts';
import { canEditRobot, canRunRobot, isRobotBuilder, memberPatchError, robotUsesLogin } from '@/lib/robots-http';
import { recorderExtensionFiles, storedZip } from '@/lib/robots-recorder-extension';
import { buildRecorderScript, PASSWORD_PLACEHOLDER } from '@/lib/robots-recorder';
import { setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import { s3Url, signS3Put } from '@/lib/robots-s3';
import { credentialMisuse, isSimpleSelector, robotDestinationSchema, robotBulkSchema, MAX_BATCH_INPUTS } from '@/lib/robots-schema';
import { robotInterpreter, type RobotPage } from '@/lib/robots-interpreter';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
  vi.stubEnv('ROBOTS_QUEUE_KICK', 'false');
  vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', 'unlimited');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRobotBackendForTests(undefined);
});

/** Backend que se queda abierto hasta que el test lo suelta. */
function heldBackend() {
  const started: RobotJob[] = [];
  const release: Array<() => void> = [];
  const backend: RobotBackend = {
    name: 'local',
    run: (job) =>
      new Promise((resolve) => {
        started.push(job);
        release.push(() => resolve({ status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 }));
      }),
  };
  return { backend, started, release };
}

const instantBackend: RobotBackend = {
  name: 'local',
  run: async () => ({ status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 }),
};

async function robotIn(ws: string, withInput = false) {
  const res = await createRobot(ws, ws, {
    name: 'R',
    steps: [{ type: 'goto', url: withInput ? 'https://example.com/{{inputs.q}}' : 'https://example.com' }],
    inputs: withInput ? [{ name: 'q', label: 'Q', kind: 'text', required: false }] : undefined,
  });
  if (!res.ok) throw new Error(res.error);
  return res.robot;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('corridas a la vez', () => {
  it('por defecto corre de a una y la segunda queda en cola', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    expect((await getRobotWorkspaceConfig(u.id)).concurrency).toBe(1);
    const held = heldBackend();
    setRobotBackendForTests(held.backend);
    const first = startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    await vi.waitFor(() => expect(held.started.length).toBe(1));
    const second = await startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    expect(second.ok && second.queued).toBe(true);
    held.release[0]();
    await first;
  });

  it('con 2, dos corren juntas y la tercera espera (positivo y bloqueado)', async () => {
    const u = await makeUser();
    await setRobotWorkspaceConfig(u.id, { concurrency: 2 });
    const r = await robotIn(u.id);
    const held = heldBackend();
    setRobotBackendForTests(held.backend);
    const a = startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    await vi.waitFor(() => expect(held.started.length).toBe(1));
    const b = startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    await vi.waitFor(() => expect(held.started.length).toBe(2));
    const c = await startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    expect(c.ok && c.queued).toBe(true);
    held.release.forEach((f) => f());
    await Promise.all([a, b]);
  });

  it('un robot con sesión guardada no corre contra sí mismo', async () => {
    const u = await makeUser();
    await setRobotWorkspaceConfig(u.id, { concurrency: 3 });
    const r = await robotIn(u.id);
    await updateRobot(u.id, r.id, { persistSession: true });
    const held = heldBackend();
    setRobotBackendForTests(held.backend);
    const a = startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    await vi.waitFor(() => expect(held.started.length).toBe(1));
    const b = await startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    expect(b.ok && b.queued).toBe(true);
    held.release[0]();
    await a;
  });

  it('el tope lo pone el servidor', async () => {
    const u = await makeUser();
    vi.stubEnv('ROBOTS_MAX_CONCURRENCY', '3');
    expect((await setRobotWorkspaceConfig(u.id, { concurrency: 40 })).concurrency).toBe(3);
  });

  it('drenar respeta el cupo y arranca varias del mismo workspace', async () => {
    const u = await makeUser();
    await setRobotWorkspaceConfig(u.id, { concurrency: 2 });
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const res = await enqueueRobotBatch(u.id, r.id, [{ q: '1' }, { q: '2' }, { q: '3' }]);
    expect(res.ok).toBe(true);
    expect(await drainRobotQueue({ workspaceId: u.id, budgetMs: 600_000, concurrency: 5 })).toBe(3);
    const batch = await getRobotBatch(u.id, res.ok ? res.batchId : '');
    expect(batch?.counts.success).toBe(3);
    expect(batch?.done).toBe(true);
  });

  it('un lote enorme de un workspace no tapa la cola de otro', async () => {
    const big = await makeUser();
    const small = await makeUser();
    const rBig = await robotIn(big.id, true);
    const rSmall = await robotIn(small.id, true);
    setRobotBackendForTests(instantBackend);
    const db = getDb();
    const ts = new Date(Date.now() - 60_000).toISOString();
    // Más filas que la ventana vieja (LIMIT 500) y todas anteriores a la del otro workspace.
    for (let i = 0; i < 600; i += 100) {
      const vals = Array.from({ length: 100 }, (_, k) => `('${crypto.randomUUID()}-${i + k}', '${rBig.id}', '${big.id}', 'queued', 'api', '{"q":"x"}', 'b1', '${ts}')`).join(',');
      await db.prepare(`INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, batch_id, created_at) VALUES ${vals}`).run();
    }
    const res = await enqueueRobotBatch(small.id, rSmall.id, [{ q: 'mine' }]);
    expect(res.ok).toBe(true);
    // El orden entre workspaces es al azar y la base de los tests tiene otros: pocas pasadas alcanzan.
    let batch = await getRobotBatch(small.id, res.ok ? res.batchId : '');
    for (let i = 0; i < 60 && batch?.counts.success !== 1; i++) {
      await drainRobotQueue({ budgetMs: 1, concurrency: 2 });
      batch = await getRobotBatch(small.id, res.ok ? res.batchId : '');
    }
    expect(batch?.counts.success).toBe(1);
    // Y el lote grande sigue casi entero: no hubo que vaciarlo antes.
    const big2 = await getRobotBatch(big.id, 'b1', undefined, { limit: 1 });
    expect(big2?.counts.queued).toBeGreaterThan(500);
  });
});

describe('lotes grandes', () => {
  it('una corrida manual pasa antes que un lote en cola y la cola de lotes no le cierra la puerta', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id, true);
    vi.stubEnv('ROBOTS_MAX_QUEUED', '1');
    setRobotBackendForTests(instantBackend);
    const inputs = Array.from({ length: 5 }, (_, i) => ({ q: String(i) }));
    const batch = await enqueueRobotBatch(u.id, r.id, inputs);
    expect(batch.ok).toBe(true);
    const manual = await startRobotRun(u.id, r.id, { q: 'manual' }, { trigger: 'manual' });
    expect(manual.ok && manual.run.status).toBe('success');
  });

  it('en partes: reenviar una parte no duplica y el total se acumula', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const batchId = crypto.randomUUID();
    const part1 = Array.from({ length: 1000 }, (_, i) => ({ q: `a${i}` }));
    const part2 = Array.from({ length: 500 }, (_, i) => ({ q: `b${i}` }));
    const r1 = await enqueueRobotBatch(u.id, r.id, part1, { batchId, offset: 0, total: 1500 });
    expect(r1.ok && r1.total).toBe(1000);
    // Nada arranca hasta que llega la última parte.
    expect(await getRobotBatch(u.id, batchId)).toBeNull();
    const again = await enqueueRobotBatch(u.id, r.id, part1, { batchId, offset: 0, total: 1500 });
    expect(again.ok && again.total).toBe(1000);
    const r2 = await enqueueRobotBatch(u.id, r.id, part2, { batchId, offset: 1000, total: 1500 });
    expect(r2.ok && r2.total).toBe(1500);
    const page = await getRobotBatch(u.id, batchId, undefined, { limit: 10, offset: 1000 });
    expect(page?.total).toBe(1500);
    expect(page?.runs.length).toBe(10);
    expect(page?.runs[0].input).toEqual({ q: 'b0' });
    expect((await listRobotBatches(u.id, r.id))[0]).toMatchObject({ id: batchId, total: 1500 });
  });

  it('corta en 50.000 y por pedido en 1.000', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const over = await enqueueRobotBatch(u.id, r.id, [{ q: 'x' }, { q: 'y' }], { batchId: crypto.randomUUID(), offset: MAX_BATCH_INPUTS - 1, total: MAX_BATCH_INPUTS });
    expect(over).toMatchObject({ ok: false, error: 'too_many_inputs' });
    expect(robotBulkSchema.safeParse({ inputs: Array.from({ length: 1001 }, () => ({})) }).success).toBe(false);
  });

  it('un id de lote de otro workspace (o de otro robot) no sirve', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const ra = await robotIn(a.id, true);
    const ra2 = await robotIn(a.id, true);
    const rb = await robotIn(b.id, true);
    setRobotBackendForTests(instantBackend);
    const batchId = crypto.randomUUID();
    await enqueueRobotBatch(a.id, ra.id, [{ q: '1' }], { batchId, offset: 0, total: 1 });
    expect(await enqueueRobotBatch(b.id, rb.id, [{ q: '2' }], { batchId, offset: 0, total: 1 })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await enqueueRobotBatch(a.id, ra2.id, [{ q: '2' }], { batchId, offset: 0, total: 1 })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await getRobotBatch(b.id, batchId)).toBeNull();
    expect(await cancelRobotBatch(b.id, batchId)).toBeNull();
    expect((await getRobotBatch(a.id, batchId))?.counts.queued).toBe(1);
  });

  it('cancelar saca solo lo que está en cola y no cuenta como falla del robot', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const res = await enqueueRobotBatch(u.id, r.id, [{ q: '1' }, { q: '2' }]);
    if (!res.ok) throw new Error(res.error);
    expect(await cancelRobotBatch(u.id, res.batchId)).toBe(2);
    expect(await cancelRobotBatch(u.id, res.batchId)).toBe(0);
    const row = await getRobotRow(u.id, r.id);
    expect(row?.consecutive_failures ?? 0).toBe(0);
    const batch = await getRobotBatch(u.id, res.batchId);
    expect(batch?.runs[0].error).toBe('canceled');
  });

  it('cancelar una corrida en cola: solo si sigue en cola y solo en su workspace', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const res = await enqueueRobotBatch(u.id, r.id, [{ q: '1' }]);
    if (!res.ok) throw new Error(res.error);
    const id = res.runs[0].id;
    expect(await cancelQueuedRun(other.id, id)).toBe(false);
    expect(await cancelQueuedRun(u.id, id)).toBe(true);
    expect(await cancelQueuedRun(u.id, id)).toBe(false);
  });
});

describe('roles', () => {
  const free = { steps: '[{"type":"goto","url":"https://a.test"}]', persist_session: 0, settings: '{}', created_by: 'me' };
  const login = { ...free, steps: '[{"type":"fill","selector":"#p","value":"{{credentials.LOGIN.password}}"}]' };
  const on = { membersCanBuild: true };
  const off = { membersCanBuild: false };
  const member = { role: 'member' as const, personId: 'me' };

  it('sin el permiso, un member no arma ni corre', () => {
    expect(isRobotBuilder('member', off)).toBe(false);
    expect(canEditRobot(member, free, off)).toBe(false);
    expect(canRunRobot(member, free, off)).toBe(false);
    expect(isRobotBuilder('admin', off)).toBe(true);
  });

  it('con el permiso: edita lo suyo y corre lo que no usa login', () => {
    expect(isRobotBuilder('member', on)).toBe(true);
    expect(canEditRobot(member, free, on)).toBe(true);
    expect(canRunRobot(member, free, on)).toBe(true);
  });

  it('bloqueado: robot ajeno, robot con login, invitado', () => {
    expect(canEditRobot(member, { ...free, created_by: 'other' }, on)).toBe(false);
    expect(canEditRobot(member, login, on)).toBe(false);
    expect(canRunRobot(member, login, on)).toBe(false);
    expect(canRunRobot(member, { ...free, persist_session: 1 }, on)).toBe(false);
    expect(canRunRobot(member, { ...free, settings: '{"destinations":[{"kind":"s3"}]}' }, on)).toBe(false);
    expect(robotUsesLogin(free)).toBe(false);
    expect(isRobotBuilder('guest', on)).toBe(false);
  });

  it('un member no puede guardar logins, sesiones ni envíos con credenciales', () => {
    expect(memberPatchError({ steps: [{ type: 'goto', url: 'https://a.test' }] })).toBeNull();
    expect(memberPatchError({ steps: [{ type: 'fill', selector: '#p', value: '{{ credentials.LOGIN.password }}' }] })).toBe('admin_only_login');
    expect(memberPatchError({ persistSession: true })).toBe('admin_only_login');
    expect(memberPatchError({ settings: { destinations: [{ kind: 'sheets' }] } })).toBe('admin_only_login');
    expect(memberPatchError({ settings: { destinations: [{ kind: 'crm' }] } })).toBeNull();
    expect(memberPatchError({ import: { steps: [{ value: '{{credentials.x.y}}' }] } })).toBe('admin_only_login');
  });
});

describe('grabación en vivo', () => {
  const steps = [{ type: 'goto', url: 'https://example.com' }, { type: 'click', selector: '#a', text: '' }];

  it('con el token entran los pasos y solo quien la abrió los ve', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const r = await robotIn(u.id);
    const rec = await createRobotRecording(u.id, r.id, 'person-a');
    if (!rec) throw new Error('no recording');
    expect(await pushRobotRecording(rec.id, rec.token, steps)).toEqual({ ok: true, count: 2 });
    expect((await getRobotRecording(u.id, rec.id, 'person-a'))?.steps.length).toBe(2);
    expect(await getRobotRecording(u.id, rec.id, 'person-b')).toBeNull();
    expect(await getRobotRecording(other.id, rec.id, 'person-a')).toBeNull();
    // Nada entra al robot hasta que la persona lo agrega.
    expect((await getRobot(u.id, r.id))?.steps.length).toBe(1);
  });

  it('bloqueado: token equivocado, vencida, borrada, pasos inválidos', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    const rec = await createRobotRecording(u.id, r.id, 'p');
    if (!rec) throw new Error('no recording');
    expect(await pushRobotRecording(rec.id, 'wrong', steps)).toEqual({ ok: false, error: 'not_found' });
    expect(await pushRobotRecording(rec.id, rec.token, [{ type: 'nope' }])).toEqual({ ok: false, error: 'invalid_steps' });
    await getDb().prepare('UPDATE robot_recordings SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', rec.id);
    expect(await pushRobotRecording(rec.id, rec.token, steps)).toEqual({ ok: false, error: 'not_found' });
    await getDb().prepare('UPDATE robot_recordings SET expires_at = ? WHERE id = ?').run('2999-01-01T00:00:00.000Z', rec.id);
    expect(await deleteRobotRecording(u.id, rec.id, 'other')).toBe(false);
    expect(await deleteRobotRecording(u.id, rec.id, 'p')).toBe(true);
    expect(await pushRobotRecording(rec.id, rec.token, steps)).toEqual({ ok: false, error: 'not_found' });
  });

  it('los pasos guardados van cifrados y sin token en claro', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    const rec = await createRobotRecording(u.id, r.id, 'p');
    if (!rec) throw new Error('no recording');
    await pushRobotRecording(rec.id, rec.token, [{ type: 'fill', selector: '#q', value: 'typed-value' }]);
    const row = (await getDb().prepare('SELECT steps, token_hash FROM robot_recordings WHERE id = ?').get(rec.id)) as { steps: string; token_hash: string };
    expect(row.steps).not.toContain('typed-value');
    expect(row.token_hash).not.toContain(rec.token);
  });

  it('el script solo lleva destino si es una grabación en vivo', () => {
    const labels = { recording: 'r', steps: 's', copy: 'c', copied: 'd', clear: 'x', close: 'q', hint: 'h' };
    expect(buildRecorderScript(labels)).toContain('var LIVE = CFG || null;');
    expect(buildRecorderScript(labels, { url: 'https://z.test/x', token: 'tk' })).toContain('"token":"tk"');
  });
});

describe('extensión del grabador', () => {
  const labels = { recording: 'r', steps: 's', copy: 'c', copied: 'd', clear: 'x', close: 'q', hint: 'h' };
  const popup = { title: 'T', code: 'C', url: 'U', start: 'S', stop: 'P', active: 'A', invalid: 'I' };

  it('manifest v3 con lo justo y sin secretos', () => {
    const files = recorderExtensionFiles(labels, popup);
    const manifest = JSON.parse(files['manifest.json']) as { manifest_version: number; permissions: string[] };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['scripting', 'storage']);
    expect(files['recorder.js']).toContain('window.__zsRecCfg');
    expect(files['recorder.js']).toContain('var LIVE = CFG || null;');
  });

  it('el zip se puede leer: firma, nombres y contenido', () => {
    const zip = storedZip({ 'a.txt': 'hola', 'b/c.txt': 'chau' });
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes('a.txt')).toBe(true);
    expect(zip.includes('hola')).toBe(true);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(2);
    expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from('hola')));
  });
});

describe('S3', () => {
  it('firma SigV4 igual al ejemplo publicado por AWS', () => {
    // Ejemplo "PUT Object" de la documentación de AWS. Las claves de ejemplo se arman en partes.
    const accessKeyId = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const secretAccessKey = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');
    const url = new URL('https://examplebucket.s3.amazonaws.com/test%24file.text');
    const headers = signS3Put(
      { accessKeyId, secretAccessKey, region: 'us-east-1' },
      url,
      'Welcome to Amazon S3.',
      { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      new Date('2013-05-24T00:00:00Z'),
    );
    expect(headers.authorization).toContain('Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
    expect(headers['x-amz-content-sha256']).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  });

  it('arma la URL de AWS y la de un servicio compatible, con la clave codificada', () => {
    expect(s3Url({ bucket: 'mi-b', region: 'sa-east-1', endpoint: '', key: 'a b/run.csv' }).toString()).toBe('https://mi-b.s3.sa-east-1.amazonaws.com/a%20b/run.csv');
    expect(s3Url({ bucket: 'mi-b', region: 'auto', endpoint: 'https://r2.test', key: 'x.json' }).toString()).toBe('https://r2.test/mi-b/x.json');
  });

  it('valida bucket, endpoint y carpeta', () => {
    const base = { id: 'a', kind: 's3', credential: 'c', bucket: 'mi-bucket' };
    expect(robotDestinationSchema.safeParse(base).success).toBe(true);
    expect(robotDestinationSchema.safeParse({ ...base, bucket: 'NO VALE' }).success).toBe(false);
    expect(robotDestinationSchema.safeParse({ ...base, endpoint: 'ftp://x' }).success).toBe(false);
    expect(robotDestinationSchema.safeParse({ ...base, endpoint: 'https://x/y' }).success).toBe(false);
    expect(robotDestinationSchema.safeParse({ ...base, prefix: '../..?x' }).success).toBe(false);
  });
});

describe('autoaprendizaje', () => {
  it('los robots nuevos lo traen apagado', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    expect(r.settings.selfHeal).toBeUndefined();
  });

  async function healing(steps: unknown[]) {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'H', steps });
    if (!res.ok) throw new Error(res.error);
    await updateRobot(u.id, res.robot.id, { settings: { selfHeal: true } });
    return { u, id: res.robot.id };
  }
  const ok = (healed: unknown[], prints?: Record<string, unknown>): RobotBackend => ({
    name: 'local',
    run: async () => ({ status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1, healed: healed as never, ...(prints ? { prints } : {}) }),
  });

  it('un paso que lee guarda el selector nuevo y deja el viejo como alternativo', async () => {
    const { u, id } = await healing([{ type: 'extract', selector: '.old', name: 'x', mode: 'text' }]);
    setRobotBackendForTests(ok([{ step: '1', from: '.old', to: 'h1.new', relearned: true }], { 'h1.new': { t: 'h1', x: 'Buy' } }));
    const run = await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect(run.ok && run.run.exports.healed?.[0].saved).toBe(true);
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: 'h1.new', fallbacks: ['.old'] });
    const stored = (await getDb().prepare('SELECT print, updated_at FROM robot_selector_prints WHERE robot_id = ?').get(id)) as { print: string };
    expect(stored.print).not.toContain('Buy');
  });

  it('un paso de acción nunca se guarda solo', async () => {
    const { u, id } = await healing([{ type: 'click', selector: '#save', text: '' }]);
    setRobotBackendForTests(ok([{ step: '1', from: '#save', to: 'button.x', relearned: true, review: true }]));
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '#save' });
    // Ni aunque el resultado no traiga la marca de revisión.
    setRobotBackendForTests(ok([{ step: '1', from: '#save', to: 'button.x', relearned: true }]));
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '#save' });
  });

  it('un valor hostil nunca entra a los pasos', async () => {
    for (const to of ['a.buy, a[title="{{credentials.QA.password}}"]', 'a[title="{{credentials.QA.password}}"]', 'a.buy, b', 'a[x="1"], script']) {
      const { u, id } = await healing([{ type: 'extract', selector: '.old', name: 'x', mode: 'text' }]);
      setRobotBackendForTests(ok([{ step: '1', from: '.old', to, relearned: true }]));
      await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
      expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '.old' });
    }
  });

  it('bloqueado: si la corrida falla o alguien editó mientras corría, no toca los pasos', async () => {
    const { u, id } = await healing([{ type: 'extract', selector: '.old', name: 'x', mode: 'text' }]);
    setRobotBackendForTests({
      name: 'local',
      run: async () => ({ status: 'failed', error: 'x', vars: {}, logs: [], screenshots: [], pages: 1, healed: [{ step: '1', from: '.old', to: 'h1.new', relearned: true }] }),
    });
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '.old' });
    setRobotBackendForTests({
      name: 'local',
      run: async () => {
        await tick();
        await getDb().prepare("UPDATE robots SET updated_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").run(id);
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1, healed: [{ step: '1', from: '.old', to: 'h1.new', relearned: true }] };
      },
    });
    const run = await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect(run.ok && run.run.exports.healed?.[0].saved).toBeUndefined();
  });

  it('apagarlo borra las huellas y la corrida no las recibe', async () => {
    const { u, id } = await healing([{ type: 'goto', url: 'https://example.com' }]);
    setRobotBackendForTests(ok([], { '.a': { t: 'a' } }));
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM robot_selector_prints WHERE robot_id = ?').get(id)) as { n: number }).n);
    expect(await count()).toBe(1);
    await updateRobot(u.id, id, { settings: { selfHeal: false } });
    expect(await count()).toBe(0);
    let job: RobotJob | null = null;
    setRobotBackendForTests({
      name: 'local',
      run: async (j) => {
        job = j;
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 };
      },
    });
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect((job as RobotJob | null)?.selfHeal).toBeUndefined();
  });

  it('una huella sin cambios no se vuelve a escribir', async () => {
    const { u, id } = await healing([{ type: 'goto', url: 'https://example.com' }]);
    setRobotBackendForTests(ok([], { '.a': { t: 'a', x: 'same' } }));
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    await getDb().prepare("UPDATE robot_selector_prints SET updated_at = 'marker' WHERE robot_id = ?").run(id);
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    const row = (await getDb().prepare('SELECT updated_at FROM robot_selector_prints WHERE robot_id = ?').get(id)) as { updated_at: string };
    expect(row.updated_at).toBe('marker');
  });
});

describe('sugerencias de pasos de acción', () => {
  async function failedWithSuggestion(to = 'button.x') {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'A', steps: [{ type: 'click', selector: '#save', text: '' }] });
    if (!res.ok) throw new Error(res.error);
    setRobotBackendForTests({
      name: 'local',
      run: async () => ({ status: 'failed', error: '1: action_timeout', vars: {}, logs: [], screenshots: [], pages: 1, healed: [{ step: '1', from: '#save', to, relearned: true, review: true }] }),
    });
    const run = await startRobotRun(u.id, res.robot.id, undefined, { trigger: 'manual' });
    if (!run.ok) throw new Error(run.error);
    return { u, id: res.robot.id, runId: run.run.id };
  }

  it('el intérprete no actúa sobre el elemento: falla y sugiere', async () => {
    const clicks: string[] = [];
    const page = {
      url: () => 'https://a.test/',
      locator: (sel: string) => {
        const loc = { first: () => loc, count: async () => 0, click: async () => { clicks.push(sel); throw new Error('Timeout exceeded'); } };
        return loc;
      },
      waitForTimeout: async () => {},
      screenshot: async () => new Uint8Array(),
      evaluate: async () => '{}',
    } as unknown as RobotPage;
    const res = await robotInterpreter(page, [{ type: 'click', selector: '#save', text: '' }], {}, {
      deadline: Date.now() + 8000,
      checkUrl: async () => null,
      selfHeal: {
        prints: { '#save': { t: 'button', nm: 'Save', a: {}, o: 'https://a.test' } },
        evaluate: async () => JSON.stringify({ parts: [{ t: 'button', id: 'save-2' }] }),
      },
    });
    expect(res.status).toBe('failed');
    expect(clicks).toEqual(['#save']);
    expect(res.healed).toEqual([{ step: '1', from: '#save', to: 'button#save-2', relearned: true, review: true }]);
  });

  it('aprobar guarda el selector y el viejo queda de alternativo; dos veces no', async () => {
    const { u, id, runId } = await failedWithSuggestion();
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '#save' });
    expect((await approveSuggestedSelector(u.id, runId, '1')).ok).toBe(true);
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: 'button.x', fallbacks: ['#save'] });
    expect(await approveSuggestedSelector(u.id, runId, '1')).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('bloqueado: otro workspace, paso cambiado, valor hostil', async () => {
    const { u, id, runId } = await failedWithSuggestion();
    const other = await makeUser();
    expect(await approveSuggestedSelector(other.id, runId, '1')).toMatchObject({ ok: false, error: 'not_found' });
    await updateRobot(u.id, id, { steps: [{ type: 'click', selector: '#other', text: '' }] });
    expect(await approveSuggestedSelector(u.id, runId, '1')).toMatchObject({ ok: false, error: 'stale' });
    const bad = await failedWithSuggestion('a, b[title="{{credentials.Q.password}}"]');
    expect(await approveSuggestedSelector(bad.u.id, bad.runId, '1')).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('avisos', () => {
  const notices = async (userId: string) =>
    (await getDb().prepare("SELECT title, body, href FROM notifications WHERE user_id = ? AND source_type = 'robot'").all(userId)) as Array<{ title: string; body: string; href: string }>;

  it('lote en pausa: un aviso a quien lo lanzó, una vez por pausa, con link', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const res = await enqueueRobotBatch(u.id, r.id, [{ q: '1' }, { q: '2' }], { actorId: u.id });
    if (!res.ok) throw new Error(res.error);
    expect(await syncPausedBatchNotices(u.id)).toBe(0);
    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', '1');
    await getDb().prepare('INSERT INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, 1, ?)').run(u.id, new Date().toISOString().slice(0, 7), 120_000);
    await drainRobotQueue({ workspaceId: u.id, budgetMs: 600_000, concurrency: 2 });
    await drainRobotQueue({ workspaceId: u.id, budgetMs: 600_000, concurrency: 2 });
    const list = await notices(u.id);
    expect(list.length).toBe(1);
    expect(list[0].href).toBe(`/app/robots/${r.id}?tab=runs`);
    // Vuelven los minutos y otra pausa: otro aviso.
    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', '100');
    expect(await syncPausedBatchNotices(u.id)).toBe(0);
    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', '1');
    expect(await syncPausedBatchNotices(u.id)).toBe(1);
  });

  it('el aviso no va a quien perdió acceso a Robots: va al dueño', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const team = crypto.randomUUID();
    await getDb().prepare('INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').run(team, 'T', `t-${team}`, owner.id);
    await getDb().prepare(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["crm"]')`).run(team, m.id);
    expect(await noticeRecipient(owner.id, m.id)).toBe(owner.id);
    await getDb().prepare(`UPDATE team_members SET apps = '["robots"]' WHERE user_id = ?`).run(m.id);
    expect(await noticeRecipient(owner.id, m.id)).toBe(m.id);
    expect(await noticeRecipient(owner.id, 'se-fue')).toBe(owner.id);
  });

  it('credencial fuera de un fill: no pausa ni suma fallas, un solo aviso por robot', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    await updateRobot(u.id, r.id, { enabled: true, pauseAfter: 1 });
    setRobotBackendForTests({
      name: 'local',
      run: async () => ({ status: 'failed', error: '2: credential_not_allowed', vars: {}, logs: [], screenshots: [], pages: 0 }),
    });
    for (let i = 0; i < 3; i++) await startRobotRun(u.id, r.id, undefined, { trigger: 'schedule' });
    const row = await getRobotRow(u.id, r.id);
    expect(row?.enabled).toBe(1);
    expect(Number(row?.consecutive_failures ?? 0)).toBe(0);
    const list = await notices(u.id);
    expect(list.length).toBe(1);
    expect(list[0].body).toContain('Step 2');
  });
});

describe('credenciales fuera de un fill', () => {
  it('detecta selector, URL, script y variantes; el valor de un fill pasa', () => {
    expect(credentialMisuse([{ type: 'fill', selector: '#p', value: '{{credentials.L.password}}' }])).toBeNull();
    expect(credentialMisuse([{ type: 'goto', url: 'https://a.test?x={{credentials.L.password}}' }])).toBe(0);
    expect(credentialMisuse([{ type: 'click', selector: 'a[x="{{ credentials.L.password | trim }}"]' }])).toBe(0);
    expect(credentialMisuse([{ type: 'fill', selector: '{{credentials}}', value: 'x' }])).toBe(0);
    expect(credentialMisuse([{ type: 'evaluate', name: 'a', script: 'return "{{credentials.L.password}}"' }])).toBe(0);
    expect(credentialMisuse([{ type: 'goto', url: 'https://a.test' }, { type: 'loop_over', list: '{{credentials.L.password}}', steps: [] }])).toBe(1);
    expect(credentialMisuse([{ type: 'loop_over', list: 'a', steps: [{ type: 'goto', url: '{{credentials.L.password}}' }] }])).toBe(0);
  });

  it('guardar lo rechaza', async () => {
    const u = await makeUser();
    expect(await createRobot(u.id, u.id, { name: 'x', steps: [{ type: 'goto', url: 'https://a.test/{{credentials.L.password}}' }] })).toMatchObject({ ok: false, error: 'credential_misuse' });
    const r = await robotIn(u.id);
    expect(await updateRobot(u.id, r.id, { steps: [{ type: 'evaluate', name: 'a', script: '{{credentials.L.password}}' }] })).toMatchObject({ ok: false, error: 'credential_misuse' });
  });

  it('correr lo frena aunque ya esté guardado (robots viejos)', async () => {
    const page = { url: () => '', locator: () => ({}), waitForTimeout: async () => {}, screenshot: async () => new Uint8Array(), evaluate: async () => '{}' } as unknown as RobotPage;
    const res = await robotInterpreter(page, [{ type: 'click', selector: 'a[x="{{credentials.L.password}}"]' }], {}, { deadline: Date.now() + 5000, checkUrl: async () => null, credentials: { L: { password: 'hunter2' } } });
    expect(res.status).toBe('failed');
    expect(res.error).toContain('credential_not_allowed');
    expect(JSON.stringify(res)).not.toContain('hunter2');
  });

  it('un robot con login armado por un member no corre, aunque lo lance un admin o el cron', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const team = crypto.randomUUID();
    await getDb().prepare('INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').run(team, 'T', `t-${team}`, owner.id);
    await getDb().prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(team, m.id);
    const res = await createRobot(owner.id, m.id, { name: 'x', steps: [{ type: 'goto', url: 'https://a.test' }] });
    if (!res.ok) throw new Error(res.error);
    // Aparece un login en los pasos sin pasar por el guardado.
    await getDb().prepare('UPDATE robots SET steps = ? WHERE id = ?').run(JSON.stringify([{ type: 'fill', selector: '#p', value: '{{credentials.L.password}}' }]), res.robot.id);
    setRobotBackendForTests(instantBackend);
    expect(await startRobotRun(owner.id, res.robot.id, undefined, { trigger: 'manual', actorId: owner.id })).toMatchObject({ ok: false, error: 'admin_only_login' });
    expect(await startRobotRun(owner.id, res.robot.id, undefined, { trigger: 'schedule' })).toMatchObject({ ok: false, error: 'admin_only_login' });
  });
});

describe('selectores simples', () => {
  it('acepta lo que arma el intérprete y nada más', () => {
    for (const ok of ['a', 'a.buy', 'button#save', 'input[name="q"]', 'body > main > div:nth-of-type(2)', ':scope > div > span', 'a[aria-label="Sign in"]']) expect(isSimpleSelector(ok), ok).toBe(true);
    for (const bad of ['a, b', 'a[title="{{credentials.x.y}}"]', '{{x}}', 'a[x="1"] b', 'a:has(b)', 'a[x=1]', 'a[x="a\\"b"]', '']) expect(isSimpleSelector(bad), bad).toBe(false);
  });
});

describe('recorder: lo grabado es dato', () => {
  it('el servidor neutraliza plantillas y deja solo el marcador en un valor', () => {
    const out = neutralizeRecorded([
      { type: 'fill', selector: 'a[x="{{credentials.Q.password}}"]', value: '{{credentials.Q.password}}' },
      { type: 'fill', selector: '#p', value: PASSWORD_PLACEHOLDER },
      { type: 'goto', url: PASSWORD_PLACEHOLDER },
    ]) as Array<Record<string, string>>;
    expect(JSON.stringify(out[0])).not.toContain('{{');
    expect(out[1].value).toBe(PASSWORD_PLACEHOLDER);
    expect(out[2].url).not.toContain('{{');
  });
});

describe('cuota y lotes', () => {
  it('sin minutos el lote queda en pausa, sin fallar filas ni eventos', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id, true);
    setRobotBackendForTests(instantBackend);
    const res = await enqueueRobotBatch(u.id, r.id, [{ q: '1' }, { q: '2' }]);
    if (!res.ok) throw new Error(res.error);
    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', '1');
    await getDb().prepare('INSERT INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, 1, ?)').run(u.id, new Date().toISOString().slice(0, 7), 120_000);
    expect(await drainRobotQueue({ workspaceId: u.id, budgetMs: 600_000, concurrency: 2 })).toBe(0);
    expect((await getRobotBatch(u.id, res.batchId))?.counts.queued).toBe(2);
    expect((await listRobotBatches(u.id, r.id))[0].paused).toBe(true);
  });

  it('una parte inválida no deja arrancar nada', async () => {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'x', steps: [{ type: 'goto', url: 'https://a.test/{{inputs.q}}' }], inputs: [{ name: 'q', label: 'Q', kind: 'text', required: true }] });
    if (!res.ok) throw new Error(res.error);
    setRobotBackendForTests(instantBackend);
    const batchId = crypto.randomUUID();
    expect((await enqueueRobotBatch(u.id, res.robot.id, [{ q: 'a' }], { batchId, offset: 0, total: 2 })).ok).toBe(true);
    expect(await enqueueRobotBatch(u.id, res.robot.id, [{}], { batchId, offset: 1, total: 2 })).toMatchObject({ ok: false, error: 'missing_input' });
    expect(await getRobotBatch(u.id, batchId)).toBeNull();
  });
});
