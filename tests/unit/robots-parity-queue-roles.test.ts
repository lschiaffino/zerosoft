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
  pushRobotRecording,
  setRobotWorkspaceConfig,
  startRobotRun,
  updateRobot,
} from '@/lib/robots';
import { canEditRobot, canRunRobot, isRobotBuilder, memberPatchError, robotUsesLogin } from '@/lib/robots-http';
import { recorderExtensionFiles, storedZip } from '@/lib/robots-recorder-extension';
import { buildRecorderScript } from '@/lib/robots-recorder';
import { setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import { s3Url, signS3Put } from '@/lib/robots-s3';
import { robotDestinationSchema, robotBulkSchema, MAX_BATCH_INPUTS } from '@/lib/robots-schema';
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
    await drainRobotQueue({ budgetMs: 1, concurrency: 2 });
    const batch = await getRobotBatch(small.id, res.ok ? res.batchId : '');
    expect(batch?.counts.success).toBe(1);
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
    const r1 = await enqueueRobotBatch(u.id, r.id, part1, { batchId, offset: 0 });
    expect(r1.ok && r1.total).toBe(1000);
    const again = await enqueueRobotBatch(u.id, r.id, part1, { batchId, offset: 0 });
    expect(again.ok && again.total).toBe(1000);
    const r2 = await enqueueRobotBatch(u.id, r.id, part2, { batchId, offset: 1000 });
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
    const over = await enqueueRobotBatch(u.id, r.id, [{ q: 'x' }, { q: 'y' }], { batchId: crypto.randomUUID(), offset: MAX_BATCH_INPUTS - 1 });
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
    await enqueueRobotBatch(a.id, ra.id, [{ q: '1' }], { batchId, offset: 0 });
    expect(await enqueueRobotBatch(b.id, rb.id, [{ q: '2' }], { batchId, offset: 1 })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await enqueueRobotBatch(a.id, ra2.id, [{ q: '2' }], { batchId, offset: 1 })).toMatchObject({ ok: false, error: 'not_found' });
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
  it('los robots nuevos lo traen prendido; los existentes no cambian', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    expect(r.settings.selfHeal).toBe(true);
    await getDb().prepare("UPDATE robots SET settings = '{}' WHERE id = ?").run(r.id);
    expect((await getRobot(u.id, r.id))?.settings.selfHeal).toBeUndefined();
  });

  it('una corrida con selector reencontrado lo guarda y deja el viejo como alternativo', async () => {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'H', steps: [{ type: 'goto', url: 'https://example.com' }, { type: 'click', selector: '.old', text: '' }] });
    if (!res.ok) throw new Error(res.error);
    setRobotBackendForTests({
      name: 'local',
      run: async (job) => {
        expect(job.selfHeal).toBeDefined();
        return {
          status: 'success',
          error: null,
          vars: {},
          logs: [],
          screenshots: [],
          pages: 1,
          healed: [{ step: '2', from: '.old', to: '.new', relearned: true }],
          prints: { '.new': { t: 'a', x: 'Buy' } },
        };
      },
    });
    const run = await startRobotRun(u.id, res.robot.id, undefined, { trigger: 'manual' });
    expect(run.ok && run.run.exports.healed?.[0].saved).toBe(true);
    const after = await getRobot(u.id, res.robot.id);
    expect(after?.steps[1]).toMatchObject({ selector: '.new', fallbacks: ['.old'] });
    const stored = (await getDb().prepare('SELECT print FROM robot_selector_prints WHERE robot_id = ? AND selector = ?').get(res.robot.id, '.new')) as { print: string };
    expect(stored.print).not.toContain('Buy');
  });

  it('bloqueado: si la corrida falla o alguien editó mientras corría, no toca los pasos', async () => {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'H', steps: [{ type: 'click', selector: '.old', text: '' }] });
    if (!res.ok) throw new Error(res.error);
    const id = res.robot.id;
    setRobotBackendForTests({
      name: 'local',
      run: async () => ({ status: 'failed', error: 'x', vars: {}, logs: [], screenshots: [], pages: 1, healed: [{ step: '1', from: '.old', to: '.new', relearned: true }] }),
    });
    await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '.old' });
    setRobotBackendForTests({
      name: 'local',
      run: async () => {
        await tick();
        await getDb().prepare("UPDATE robots SET updated_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").run(id);
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1, healed: [{ step: '1', from: '.old', to: '.new', relearned: true }] };
      },
    });
    const run = await startRobotRun(u.id, id, undefined, { trigger: 'manual' });
    expect(run.ok && run.run.exports.healed?.[0].saved).toBeUndefined();
    expect((await getRobot(u.id, id))?.steps[0]).toMatchObject({ selector: '.old' });
  });

  it('apagado: la corrida no recibe huellas', async () => {
    const u = await makeUser();
    const r = await robotIn(u.id);
    await updateRobot(u.id, r.id, { settings: { selfHeal: false } });
    let job: RobotJob | null = null;
    setRobotBackendForTests({
      name: 'local',
      run: async (j) => {
        job = j;
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 };
      },
    });
    await startRobotRun(u.id, r.id, undefined, { trigger: 'manual' });
    expect((job as RobotJob | null)?.selfHeal).toBeUndefined();
  });
});
