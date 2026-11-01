import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createChannel, postMessage, type TalkActor } from '@/lib/talk';
import { neutralizeAgentText, sendDailyRecaps } from '@/lib/talk-ai';
import { agentKeySpent, extractMentions } from '@/lib/talk-markdown';
import { setPrefs } from '@/lib/talk-extras';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('TALK_AI_FAKE', '1');
});

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const team = await createTeam(owner.id, `${label} team`);
  await addMember(team.id, ana.id);
  const a: TalkActor = { workspaceId: owner.id, personId: ana.id, role: 'member', teamId: team.id };
  return { owner, ana, team, a };
}

describe('/ask: clave de idempotencia', () => {
  it('solo un rechazo 4xx la gasta; un 5xx o 504 la guarda para reintentar sin publicar ni pagar dos veces', () => {
    expect(agentKeySpent(400)).toBe(true);
    expect(agentKeySpent(403)).toBe(true);
    expect(agentKeySpent(404)).toBe(true);
    expect(agentKeySpent(429)).toBe(true);
    // La primera sigue en curso: con la misma clave, el reintento devuelve lo publicado.
    expect(agentKeySpent(409)).toBe(false);
    expect(agentKeySpent(500)).toBe(false);
    expect(agentKeySpent(502)).toBe(false);
    expect(agentKeySpent(504)).toBe(false);
  });
});

describe('/ask: lo que escribe el modelo', () => {
  it('un token con "<" en la etiqueta no avisa al canal', () => {
    for (const raw of ['<<!channel|a<b>', '<!channel|a<b>', 'hola <<!here|x<y> chau', '<<<@u1|a<b>', '<#c1|a<b<c>']) {
      const out = neutralizeAgentText(raw);
      const m = extractMentions(out);
      expect(m.channel || m.here, raw).toBe(false);
      expect(m.users, raw).toEqual([]);
      expect(out, raw).not.toMatch(/<[@#!]/);
    }
  });

  it('un link con etiqueta en varias líneas muestra el destino real', () => {
    expect(neutralizeAgentText('mirá <https://malo.example/x|Tu\nbanco>')).toBe('mirá Tu banco (https://malo.example/x)');
    expect(neutralizeAgentText('[Tu\n  banco](https://malo.example/x)')).toBe('Tu banco (https://malo.example/x)');
    expect(neutralizeAgentText('<mailto:a@malo.example|Soporte\noficial>')).toBe('Soporte oficial (mailto:a@malo.example)');
  });
});

describe('recap diario: reparto y IA apagada', () => {
  const notices = async (id: string) => Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'talk_recap' AND user_id = ?").get(id)) as { n: number }).n);

  it('un workspace con cientos vencidos antes no deja afuera al chico', async () => {
    const big = await makeUser('rf-big');
    const db = getDb();
    for (let i = 0; i < 400; i++) {
      await db
        .prepare("INSERT INTO talk_prefs (workspace_id, user_id, recap_daily, recap_next_at) VALUES (?, ?, 1, ?)")
        .run(big.id, `rf-ghost-${i}`, new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString());
    }
    const w = await workspace('rf1');
    const c = await createChannel(w.a, { name: 'rf-uno', kind: 'public' });
    await postMessage(w.a, { channelId: c.id, body: 'novedad' });
    await setPrefs(w.a, { recapDaily: true });
    await db.prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run('2021-01-01T00:00:00.000Z', w.owner.id, w.ana.id);
    await sendDailyRecaps({ limit: 12, perWorkspace: 3 });
    expect(await notices(w.ana.id)).toBe(1);
    // Del grande se tomaron como mucho 3 en esta corrida.
    const claimed = (await db.prepare("SELECT COUNT(*) AS n FROM talk_prefs WHERE workspace_id = ? AND (recap_daily = 0 OR recap_next_at > '2020-12-31')").get(big.id)) as { n: number };
    expect(Number(claimed.n)).toBeLessThanOrEqual(3);
  });

  it('con la IA apagada en toda la plataforma no se desuscribe a nadie y vuelve sola', async () => {
    vi.stubEnv('TALK_AI_FAKE', '');
    vi.stubEnv('AI_ENABLED', 'false');
    const w = await workspace('rf2');
    const c = await createChannel(w.a, { name: 'rf-dos', kind: 'public' });
    await postMessage(w.a, { channelId: c.id, body: 'novedad' });
    await setPrefs(w.a, { recapDaily: true });
    const db = getDb();
    await db.prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run('2020-01-01T00:00:00.000Z', w.owner.id, w.ana.id);
    await sendDailyRecaps({ limit: 500, perWorkspace: 500 });
    const row = (await db.prepare('SELECT recap_daily, recap_next_at FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.ana.id)) as { recap_daily: number; recap_next_at: string };
    expect(Number(row.recap_daily)).toBe(1);
    expect(row.recap_next_at > new Date().toISOString()).toBe(true);
    expect(await notices(w.ana.id)).toBe(0);
    // Vuelve la IA: el recap sale sin que nadie lo vuelva a activar.
    vi.stubEnv('TALK_AI_FAKE', '1');
    vi.stubEnv('AI_ENABLED', '');
    await db.prepare('UPDATE talk_prefs SET recap_next_at = ? WHERE workspace_id = ? AND user_id = ?').run('2020-01-01T00:00:00.000Z', w.owner.id, w.ana.id);
    await sendDailyRecaps({ limit: 500, perWorkspace: 500 });
    expect(await notices(w.ana.id)).toBe(1);
  });
});
