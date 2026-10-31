import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { addMembers, createChannel, deleteChannel, listEventsSince, postMessage, readableChannel, removeMember, updateChannel, type TalkActor } from '@/lib/talk';
import { AGENT_BOT_NAME, askInChannel, fairRecapBatch, neutralizeAgentText, nextRecapAt, sendDailyRecaps } from '@/lib/talk-ai';
import { extractMentions } from '@/lib/talk-markdown';
import { setPrefs } from '@/lib/talk-extras';
import { searchApps } from '@/lib/app-search';
import { CLIP_AUDIO_BPS, CLIP_MAX_BYTES, CLIP_VIDEO_BPS, clipFileName, clipMaxSeconds, pickClipMime } from '@/lib/talk-clips';
import { createCommand } from '@/lib/talk-commands';
import { acceptGuestInvite, inviteGuest } from '@/lib/talk-guests';
import { MAX_BOOKMARKS, createBookmark, deleteBookmark, listBookmarks, normalizeBookmarkUrl, updateBookmark } from '@/lib/talk-bookmarks';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('TALK_AI_FAKE', '1');
});

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const bob = await makeUser(`${label}-bob`);
  const team = await createTeam(owner.id, `${label} team`);
  await addMember(team.id, ana.id);
  await addMember(team.id, bob.id);
  const actor = (id: string, role: TalkActor['role'] = 'member'): TalkActor => ({ workspaceId: owner.id, personId: id, role, teamId: team.id });
  return { owner, ana, bob, team, o: actor(owner.id, 'owner'), a: actor(ana.id), b: actor(bob.id) };
}

describe('marcadores del canal', () => {
  it('normaliza links y rechaza lo que no es http(s)', () => {
    expect(normalizeBookmarkUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizeBookmarkUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeBookmarkUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
    for (const bad of ['https://./', 'https://a..b/', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'mailto:a@b.co', 'file:///etc/passwd', 'vbscript:x', 'nada', '', 'https://user:pw@example.com']) {
      expect(normalizeBookmarkUrl(bad), bad).toBeNull();
    }
  });

  it('miembro crea, edita y borra; el título por defecto es el sitio; hay evento del canal', async () => {
    const w = await workspace('bm1');
    const c = await createChannel(w.a, { name: 'bm-uno', kind: 'public' });
    const b = await createBookmark(w.a, c.id, { url: 'https://www.example.com/plan' });
    expect(b.title).toBe('example.com');
    const edited = await updateBookmark(w.a, c.id, b.id, { title: 'Plan' });
    expect(edited.title).toBe('Plan');
    expect(edited.url).toBe('https://www.example.com/plan');
    expect((await listBookmarks(w.a, c.id)).map((x) => x.title)).toEqual(['Plan']);
    const ev = await listEventsSince(w.a, 0, 500);
    expect(ev.events.filter((e) => e.kind === 'bookmark' && e.channelId === c.id).length).toBe(2);
    expect(await deleteBookmark(w.a, c.id, b.id)).toBe(true);
    expect(await deleteBookmark(w.a, c.id, b.id)).toBe(false);
    await expect(createBookmark(w.a, c.id, { url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_bookmark_url' });
    await expect(updateBookmark(w.a, c.id, 'x', { title: 'y' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('no miembro de un público lee pero no escribe; privado ajeno da 404; archivado es solo lectura', async () => {
    const w = await workspace('bm2');
    const pub = await createChannel(w.a, { name: 'bm-pub', kind: 'public' });
    const priv = await createChannel(w.a, { name: 'bm-priv', kind: 'private' });
    const bm = await createBookmark(w.a, pub.id, { url: 'https://example.com', title: 'Público' });
    await createBookmark(w.a, priv.id, { url: 'https://secret.example.com', title: 'Secreto' });
    expect(await listBookmarks(w.b, pub.id)).toHaveLength(1);
    await expect(createBookmark(w.b, pub.id, { url: 'https://example.com' })).rejects.toMatchObject({ status: 403 });
    await expect(deleteBookmark(w.b, pub.id, bm.id)).rejects.toMatchObject({ status: 403 });
    await expect(listBookmarks(w.b, priv.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(createBookmark(w.b, priv.id, { url: 'https://example.com' })).rejects.toMatchObject({ status: 404 });
    // Un marcador de otro canal no se toca por este.
    await expect(deleteBookmark(w.a, priv.id, bm.id)).resolves.toBe(false);
    await updateChannel(w.a, pub.id, { archived: true });
    await expect(createBookmark(w.a, pub.id, { url: 'https://example.com' })).rejects.toBeTruthy();
  });

  it('el que sale de un privado deja de leerlo y de ver sus eventos', async () => {
    const w = await workspace('bm3');
    const priv = await createChannel(w.a, { name: 'bm-salida', kind: 'private' });
    await addMembers(priv.id, [w.bob.id]);
    expect(await listBookmarks(w.b, priv.id)).toEqual([]);
    await removeMember(w.a, priv.id, w.bob.id);
    await expect(listBookmarks(w.b, priv.id)).rejects.toMatchObject({ code: 'not_found' });
    await createBookmark(w.a, priv.id, { url: 'https://example.com' });
    const ev = await listEventsSince(w.b, 0, 500);
    expect(ev.events.some((e) => e.kind === 'bookmark' && e.channelId === priv.id)).toBe(false);
  });

  it('un invitado solo ve los de sus canales', async () => {
    const w = await workspace('bm4');
    const shared = await createChannel(w.a, { name: 'bm-cliente', kind: 'public' });
    const other = await createChannel(w.a, { name: 'bm-interno', kind: 'public' });
    await createBookmark(w.a, other.id, { url: 'https://interno.example.com' });
    const gina = await makeUser('bm-gina');
    const res = await inviteGuest(w.o, { email: gina.email, channelIds: [shared.id] });
    if (res.kind !== 'invited') throw new Error('expected invite');
    await acceptGuestInvite(res.token, gina);
    const g: TalkActor = { workspaceId: w.owner.id, personId: gina.id, role: 'member', teamId: null, guest: true };
    expect(await listBookmarks(g, shared.id)).toEqual([]);
    await expect(listBookmarks(g, other.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('tiene tope por canal y se borran con el canal', async () => {
    const w = await workspace('bm5');
    const c = await createChannel(w.a, { name: 'bm-tope', kind: 'public' });
    const now = new Date().toISOString();
    for (let i = 0; i < MAX_BOOKMARKS; i++) {
      await getDb()
        .prepare('INSERT INTO talk_bookmarks (id, workspace_id, channel_id, title, url, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`bm5-${i}`, w.owner.id, c.id, `t${i}`, 'https://example.com/', w.ana.id, now, now);
    }
    await expect(createBookmark(w.a, c.id, { url: 'https://example.com/x' })).rejects.toMatchObject({ code: 'too_many_bookmarks' });
    await deleteChannel(w.o, c.id);
    const left = (await getDb().prepare('SELECT COUNT(*) AS n FROM talk_bookmarks WHERE channel_id = ?').get(c.id)) as { n: number };
    expect(Number(left.n)).toBe(0);
  });
});

describe('⌘K de marcadores', () => {
  it('encuentra los que puede leer y no los de un privado ajeno', async () => {
    const w = await workspace('bm6');
    const word = `marcadorunico${Date.now()}`;
    const pub = await createChannel(w.a, { name: 'bm-k-pub', kind: 'public' });
    const priv = await createChannel(w.a, { name: 'bm-k-priv', kind: 'private' });
    await createBookmark(w.a, pub.id, { url: 'https://example.com/a', title: `${word} publico` });
    await createBookmark(w.a, priv.id, { url: 'https://example.com/b', title: `${word} privado` });
    const scope = { id: w.owner.id, actingUser: { id: w.bob.id }, team: { id: w.team.id }, role: 'member' } as unknown as Parameters<typeof searchApps>[0];
    const items = await searchApps(scope, word);
    const labels = items.filter((i) => i.group === 'talkBookmarks').map((i) => i.label);
    expect(labels).toEqual([`${word} publico`]);
  });
});

describe('clips', () => {
  it('los topes entran en el límite de 4,5 MB de Vercel', () => {
    expect((clipMaxSeconds('video') * (CLIP_VIDEO_BPS + CLIP_AUDIO_BPS)) / 8).toBeLessThan(CLIP_MAX_BYTES);
    expect((clipMaxSeconds('audio') * CLIP_AUDIO_BPS) / 8).toBeLessThan(CLIP_MAX_BYTES);
    expect(CLIP_MAX_BYTES).toBeLessThan(4_400_000);
  });

  it('elige un formato soportado y nombra el archivo según el tipo', () => {
    expect(pickClipMime('video', (m) => m === 'video/mp4')).toBe('video/mp4');
    expect(pickClipMime('audio', () => false)).toBeNull();
    expect(clipFileName('audio/webm;codecs=opus', new Date('2026-10-31T10:00:00Z'))).toBe('clip-20261031-100000.weba');
    expect(clipFileName('video/mp4', new Date('2026-10-31T10:00:00Z'))).toBe('clip-20261031-100000.mp4');
  });
});

describe('/ask', () => {
  it('saca menciones y avisos de lo que escribe el modelo', () => {
    expect(neutralizeAgentText('hola <@u1> <!channel> <!subteam^x> <#c1> fin')).toBe('hola     fin');
    expect(neutralizeAgentText('avisen a @channel y @here')).toBe('avisen a channel y here');
  });

  it('responde en el hilo como bot, solo con lo de este canal', async () => {
    const w = await workspace('ag1');
    const here = await createChannel(w.a, { name: 'ag-aca', kind: 'public' });
    const secret = await createChannel(w.a, { name: 'ag-secreto', kind: 'private' });
    await postMessage(w.a, { channelId: secret.id, body: 'clave-secreta-del-privado' });
    await postMessage(w.a, { channelId: here.id, body: 'la demo es el viernes' });
    const res = await askInChannel(w.a, { channelId: here.id, question: 'cuando es la demo', key: 'ag1-key-0001' });
    expect(res.error).toBeNull();
    expect(res.reply?.botName).toBe(AGENT_BOT_NAME);
    expect(res.reply?.parentId).toBe(res.message.id);
    expect(res.reply?.body).toContain('la demo es el viernes');
    expect(res.reply?.body).not.toContain('clave-secreta');
  });

  it('la misma clave no publica dos veces; sin acceso no pregunta', async () => {
    const w = await workspace('ag2');
    const c = await createChannel(w.a, { name: 'ag-dos', kind: 'private' });
    await askInChannel(w.a, { channelId: c.id, question: 'hola', key: 'ag2-key-0001' });
    await askInChannel(w.a, { channelId: c.id, question: 'hola', key: 'ag2-key-0001' });
    const n = (await getDb().prepare("SELECT COUNT(*) AS n FROM talk_messages WHERE channel_id = ? AND body = 'hola'").get(c.id)) as { n: number };
    expect(Number(n.n)).toBe(1);
    await expect(askInChannel(w.b, { channelId: c.id, question: 'hola', key: 'ag2-key-0002' })).rejects.toMatchObject({ status: 404 });
    const pub = await createChannel(w.a, { name: 'ag-pub', kind: 'public' });
    await expect(askInChannel(w.b, { channelId: pub.id, question: 'hola', key: 'ag2-key-0003' })).rejects.toMatchObject({ status: 403 });
    expect(await readableChannel(w.b, pub.id)).not.toBeNull();
  });

  it('/ask no se puede registrar como comando de una app', async () => {
    const w = await workspace('ag4');
    await expect(createCommand(w.o, { command: '/ask', url: 'https://example.com/hook' })).rejects.toMatchObject({ code: 'invalid_command' });
  });
});

describe('/ask, nuevos casos', () => {
  it('saca tokens anidados hasta el final', () => {
    for (const nested of ['<<@x>!channel>', '<<!here>!channel>', '<<<@a>@b>!channel>', '<!<@x>channel>', '<<#c>@u1>', '<<@a><!channel>!here>']) {
      const out = neutralizeAgentText(nested);
      const m = extractMentions(out);
      expect(m.channel || m.here, nested).toBe(false);
      expect(m.users, nested).toEqual([]);
      expect(out, nested).not.toMatch(/<[@#!]/);
    }
    expect(extractMentions(neutralizeAgentText('<'.repeat(200) + '@x>'.repeat(200) + '!channel>')).channel).toBe(false);
  });

  it('un link con etiqueta muestra el destino real', () => {
    expect(neutralizeAgentText('mirá <https://malo.example/x|Tu banco>')).toBe('mirá Tu banco (https://malo.example/x)');
    expect(neutralizeAgentText('[Tu banco](https://malo.example/x)')).toBe('Tu banco (https://malo.example/x)');
  });

  it('la respuesta del bot se guarda sin menciones ni aviso aunque el cuerpo traiga un token', async () => {
    const w = await workspace('ag5');
    const c = await createChannel(w.a, { name: 'ag-cinco', kind: 'public' });
    const bot: TalkActor = { workspaceId: w.owner.id, personId: w.owner.id, role: 'owner', teamId: null };
    const res = await postMessage(bot, { channelId: c.id, body: `<!channel> <@${w.bob.id}>`, botName: AGENT_BOT_NAME, noMentions: true }, { asBot: true });
    expect(res.row.broadcast ?? null).toBeNull();
    const row = (await getDb().prepare('SELECT broadcast, mentions FROM talk_messages WHERE id = ?').get(res.row.id)) as { broadcast: string | null; mentions: string };
    expect(row.broadcast).toBeNull();
    expect(JSON.parse(row.mentions)).toEqual([]);
  });

  it('un reintento con la misma clave recupera el resultado; un hilo inválido no gasta la clave', async () => {
    const w = await workspace('ag6');
    const c = await createChannel(w.a, { name: 'ag-seis', kind: 'public' });
    await postMessage(w.a, { channelId: c.id, body: 'contexto' });
    const first = await askInChannel(w.a, { channelId: c.id, question: 'hola', key: 'ag6-key-0001' });
    const again = await askInChannel(w.a, { channelId: c.id, question: 'hola', key: 'ag6-key-0001' });
    expect(again.message.id).toBe(first.message.id);
    expect(again.reply?.id).toBe(first.reply?.id);
    const n = (await getDb().prepare("SELECT COUNT(*) AS n FROM talk_messages WHERE channel_id = ? AND body = 'hola'").get(c.id)) as { n: number };
    expect(Number(n.n)).toBe(1);
    await expect(askInChannel(w.a, { channelId: c.id, parentId: 'no-existe', question: 'x', key: 'ag6-key-0002' })).rejects.toMatchObject({ code: 'invalid_parent' });
    const ok = await askInChannel(w.a, { channelId: c.id, question: 'x', key: 'ag6-key-0002' });
    expect(ok.message.body).toBe('x');
    // Otra corrida en curso (sin mensaje todavía): 409, no otra publicación.
    await getDb().prepare('INSERT INTO talk_agent_runs (workspace_id, user_id, key, created_at) VALUES (?, ?, ?, ?)').run(w.owner.id, w.ana.id, 'ag6-key-0003', new Date().toISOString());
    await expect(askInChannel(w.a, { channelId: c.id, question: 'y', key: 'ag6-key-0003' })).rejects.toMatchObject({ code: 'agent_duplicate' });
    // Recuperar no abre otro canal: sin acceso, rechaza antes.
    const priv = await createChannel(w.a, { name: 'ag-seis-p', kind: 'private' });
    await expect(askInChannel(w.b, { channelId: priv.id, question: 'hola', key: 'ag6-key-0001' })).rejects.toMatchObject({ status: 404 });
    await expect(askInChannel(w.a, { channelId: priv.id, question: 'hola', key: 'ag6-key-0001' })).rejects.toMatchObject({ code: 'agent_duplicate' });
  });
});

describe('recap diario', () => {
  const ai = async (ws: string) => Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'talk_recap' AND user_id = ?").get(ws)) as { n: number }).n);

  it('la próxima es a las 8 de la zona de la persona', () => {
    expect(nextRecapAt('UTC', new Date('2026-10-31T09:30:00Z'))).toBe('2026-11-01T08:00:00.000Z');
    expect(nextRecapAt('UTC', new Date('2026-10-31T07:30:00Z'))).toBe('2026-10-31T08:00:00.000Z');
    expect(nextRecapAt('America/Argentina/Buenos_Aires', new Date('2026-10-31T09:30:00Z'))).toBe('2026-10-31T11:00:00.000Z');
    expect(nextRecapAt('no/existe', new Date('2026-10-31T07:30:00Z'))).toBe('2026-10-31T08:00:00.000Z');
  });

  it('está apagado por defecto; activado reclama una vez y mueve la fecha', async () => {
    const w = await workspace('rc1');
    const c = await createChannel(w.a, { name: 'rc-uno', kind: 'public' });
    await postMessage(w.a, { channelId: c.id, body: 'novedad' });
    const past = '2020-01-01T00:00:00.000Z';
    expect((await sendDailyRecaps({ limit: 500, now: new Date() })).sent).toBeGreaterThanOrEqual(0);
    expect(await ai(w.ana.id)).toBe(0);
    await setPrefs(w.a, { recapDaily: true });
    await getDb().prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run(past, w.owner.id, w.ana.id);
    await Promise.all([sendDailyRecaps({ limit: 500 }), sendDailyRecaps({ limit: 500 })]);
    expect(await ai(w.ana.id)).toBe(1);
    const row = (await getDb().prepare('SELECT recap_next_at FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.ana.id)) as { recap_next_at: string };
    expect(row.recap_next_at > new Date().toISOString()).toBe(true);
    await sendDailyRecaps({ limit: 500 });
    expect(await ai(w.ana.id)).toBe(1);
  });

  it('reparte entre workspaces con tope por cada uno', () => {
    const rows = [...Array.from({ length: 20 }, () => ({ workspace_id: 'grande' })), { workspace_id: 'chico1' }, { workspace_id: 'chico2' }];
    const batch = fairRecapBatch(rows, 6, 3);
    expect(batch).toHaveLength(5);
    expect(batch.filter((r) => r.workspace_id === 'grande')).toHaveLength(3);
    expect(batch.slice(0, 3).map((r) => r.workspace_id)).toEqual(['grande', 'chico1', 'chico2']);
  });

  it('usa la zona del navegador si el perfil no tiene', async () => {
    const w = await workspace('rc3');
    await setPrefs(w.a, { recapDaily: true, recapTimeZone: 'America/Argentina/Buenos_Aires' });
    const row = (await getDb().prepare('SELECT recap_next_at, recap_tz FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.ana.id)) as { recap_next_at: string; recap_tz: string };
    expect(row.recap_tz).toBe('America/Argentina/Buenos_Aires');
    expect(new Date(row.recap_next_at).getUTCHours()).toBe(11);
    await setPrefs(w.b, { recapDaily: true, recapTimeZone: 'no/existe' });
    const bad = (await getDb().prepare('SELECT recap_tz FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.bob.id)) as { recap_tz: string | null };
    expect(bad.recap_tz).toBeNull();
  });

  it('un límite de uso reintenta esa mañana y, vencida la ventana, avisa', async () => {
    const w = await workspace('rc4');
    const c = await createChannel(w.a, { name: 'rc-cuatro', kind: 'public' });
    await postMessage(w.a, { channelId: c.id, body: 'novedad' });
    await setPrefs(w.a, { recapDaily: true });
    const due = new Date(Date.now() - 60_000).toISOString();
    await getDb().prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run(due, w.owner.id, w.ana.id);
    const ai = await import('@/lib/ai');
    const quota = vi.spyOn(ai, 'assertAiQuota').mockRejectedValue(new ai.AiError('rate_limited'));
    await sendDailyRecaps({ limit: 500, perWorkspace: 500 });
    const row = async () => (await getDb().prepare('SELECT recap_next_at, recap_due_at FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.ana.id)) as { recap_next_at: string; recap_due_at: string | null };
    const retry = await row();
    expect(retry.recap_due_at).toBe(due);
    expect(new Date(retry.recap_next_at).getTime()).toBeLessThan(Date.now() + 31 * 60_000);
    const title = async () => ((await getDb().prepare("SELECT title FROM notifications WHERE type = 'talk_recap' AND user_id = ?").all(w.ana.id)) as Array<{ title: string }>).map((n) => n.title);
    expect(await title()).toEqual([]);
    // Pasada la ventana (programado hace 5 horas): no reintenta, avisa y queda para mañana.
    const old = new Date(Date.now() - 5 * 3_600_000).toISOString();
    await getDb().prepare('UPDATE talk_prefs SET recap_next_at = ?, recap_due_at = ? WHERE workspace_id = ? AND user_id = ?').run(due, old, w.owner.id, w.ana.id);
    await sendDailyRecaps({ limit: 500, perWorkspace: 500 });
    expect((await title()).join()).toContain("couldn't be made");
    const done = await row();
    expect(done.recap_due_at).toBeNull();
    expect(new Date(done.recap_next_at).getTime()).toBeGreaterThan(Date.now() + 31 * 60_000);
    quota.mockRestore();
  });

  it('sin actividad no avisa, respeta el tope y se apaga si ya no está en Talk', async () => {
    const w = await workspace('rc2');
    await setPrefs(w.b, { recapDaily: true });
    const past = '2020-01-01T00:00:00.000Z';
    await getDb().prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run(past, w.owner.id, w.bob.id);
    await sendDailyRecaps({ limit: 500 });
    expect(await ai(w.bob.id)).toBe(0);
    // Tiempo agotado: ni siquiera reclama.
    await getDb().prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run(past, w.owner.id, w.bob.id);
    await sendDailyRecaps({ limit: 500, budgetMs: -1 });
    const pending = (await getDb().prepare('SELECT recap_next_at FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.bob.id)) as { recap_next_at: string };
    expect(pending.recap_next_at).toBe(past);
    await getDb().prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(w.team.id, w.bob.id);
    await sendDailyRecaps({ limit: 500 });
    const off = (await getDb().prepare('SELECT recap_daily FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.bob.id)) as { recap_daily: number };
    expect(Number(off.recap_daily)).toBe(0);
    expect(await ai(w.bob.id)).toBe(0);
  });
});
