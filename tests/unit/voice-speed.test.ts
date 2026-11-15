import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El Gateway de transcripción, de mentira: cada test dice qué modelo falla.
const gatewayCalls = vi.hoisted(() => ({ models: [] as string[], failing: new Set<string>() }));
vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    gateway: Object.assign(real.gateway, { transcription: (id: string) => id }),
    experimental_transcribe: async ({ model }: { model: string }) => {
      gatewayCalls.models.push(model);
      if (gatewayCalls.failing.has(model)) throw new Error('model not available');
      return { text: `hola desde ${model}`, segments: [], language: 'es', durationInSeconds: 2 };
    },
  };
});

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role: string; actingUser?: null; team?: null } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u?.role === 'owner' || u?.role === 'admin',
  realUserId: (u: { id: string }) => u.id,
}));

const { getDb } = await import('@/lib/db');
const { transcribeAttempts, transcribeAudio, DICTATION_TRANSCRIBE_MODEL } = await import('@/lib/voice-transcribe');
const { addDictionaryEntry, getDictationProfile, saveVoiceSettings, voiceOwner } = await import('@/lib/voice');
const { dictate } = await import('@/lib/voice-service');
const dictateRoute = await import('@/app/api/voice/dictate/route');
const { makeUser } = await import('./helpers');

afterEach(() => {
  vi.unstubAllEnvs();
  gatewayCalls.models = [];
  gatewayCalls.failing.clear();
  session.user = null;
});

describe('transcripción de un dictado: el modelo más rápido, con respaldo', () => {
  beforeEach(() => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', '');
    vi.stubEnv('VOICE_TRANSCRIBE_MODEL', '');
    vi.stubEnv('VOICE_DICTATION_TRANSCRIBE_MODEL', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    vi.stubEnv('GROQ_API_KEY', '');
  });

  it('dictado: el modelo de dictado del Gateway y después whisper-1; reuniones: whisper-1 solo', () => {
    expect(transcribeAttempts({ purpose: 'dictation' })).toEqual([
      { provider: 'gateway', model: DICTATION_TRANSCRIBE_MODEL },
      { provider: 'gateway', model: 'openai/whisper-1' },
    ]);
    expect(transcribeAttempts({})).toEqual([{ provider: 'gateway', model: 'openai/whisper-1' }]);
  });

  it('con GROQ_API_KEY, Groq primero', () => {
    vi.stubEnv('GROQ_API_KEY', 'test');
    expect(transcribeAttempts({ purpose: 'dictation' }).map((a) => a.provider)).toEqual(['groq', 'gateway', 'gateway']);
  });

  it('VOICE_DICTATION_TRANSCRIBE_MODEL lo cambia, y un proveedor elegido a mano se respeta', () => {
    vi.stubEnv('VOICE_DICTATION_TRANSCRIBE_MODEL', 'microsoft/mai-transcribe-2');
    expect(transcribeAttempts({ purpose: 'dictation' })[0]).toEqual({ provider: 'gateway', model: 'microsoft/mai-transcribe-2' });
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'deepgram');
    expect(transcribeAttempts({ purpose: 'dictation' })).toEqual([{ provider: 'deepgram', model: 'nova-3' }]);
  });

  it('si el modelo rápido falla, transcribe con el siguiente y lo saltea en los próximos', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    vi.stubEnv('VOICE_TRANSCRIBE_FREE_MINUTES', 'unlimited');
    vi.stubEnv('VOICE_DICTATION_TRANSCRIBE_MODEL', 'test/fails-once');
    gatewayCalls.failing.add('test/fails-once');
    const u = await makeUser('voice-speed');
    const audio = new Uint8Array(1024).fill(3);
    const res = await transcribeAudio({ workspaceId: u.id, audio, mimeType: 'audio/wav', purpose: 'dictation' });
    expect(res.text).toBe('hola desde openai/whisper-1');
    expect(gatewayCalls.models).toEqual(['test/fails-once', 'openai/whisper-1']);
    gatewayCalls.models = [];
    await transcribeAudio({ workspaceId: u.id, audio, mimeType: 'audio/wav', purpose: 'dictation' });
    expect(gatewayCalls.models).toEqual(['openai/whisper-1']);
    const usage = (await getDb().prepare("SELECT model FROM ai_usage WHERE user_id = ? AND feature = 'voice_transcribe'").all(u.id)) as Array<{ model: string }>;
    expect(usage.map((r) => r.model)).toEqual(['gateway/openai/whisper-1', 'gateway/openai/whisper-1']);
  });
});

describe('dictado rápido: nada que no cambie el texto se espera', () => {
  beforeEach(() => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
    vi.stubEnv('VOICE_AI_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
  });

  it('el consumo y el historial van en un solo trabajo después de contestar', async () => {
    const u = await makeUser('voice-speed');
    const owner = voiceOwner({ id: u.id, role: 'owner' });
    const jobs: Array<() => Promise<unknown>> = [];
    const res = await dictate({ owner, audio: new Uint8Array(512).fill(1), type: 'audio/wav', context: 'chat', fast: true, later: (j) => void jobs.push(j) });
    expect(res.ai).toBe(true);
    const usage = async () => ((await getDb().prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ?').get(u.id)) as { n: number }).n;
    expect(await usage()).toBe(0);
    expect(jobs).toHaveLength(1);
    await jobs[0]();
    expect(await usage()).toBe(2);
    const saved = (await getDb().prepare("SELECT COUNT(*) AS n FROM voice_sessions WHERE workspace_id = ? AND kind = 'dictation'").get(u.id)) as { n: number };
    expect(saved.n).toBe(1);
  });

  it('sin cuota de IA, el dictado sale igual por reglas y lo dice', async () => {
    vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', '0');
    const u = await makeUser('voice-speed');
    const owner = voiceOwner({ id: u.id, role: 'owner' });
    const res = await dictate({ owner, audio: new Uint8Array(512).fill(1), type: 'audio/wav', context: 'chat', save: false });
    expect(res.ai).toBe(false);
    expect(res.aiError).toBe('quota_exceeded');
    expect(res.text).toContain('1. The landing');
  });

  it('la ruta dice dónde se fue el tiempo, sesión y subida incluidas', async () => {
    const u = await makeUser('voice-speed');
    session.user = { id: u.id, email: u.email, role: 'owner', actingUser: null, team: null };
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(2048).fill(7)], { type: 'audio/webm' }), 'a.webm');
    form.append('context', 'chat');
    const res = await dictateRoute.POST(new Request('http://t/api/voice/dictate', { method: 'POST', body: form }) as never);
    expect(res.status).toBe(201);
    const timing = res.headers.get('server-timing') ?? '';
    for (const part of ['auth', 'upload', 'setup', 'transcribe', 'cleanup', 'save', 'total']) expect(timing).toContain(`${part};dur=`);
  });

  it('un audio inválido sigue dando su error aunque los ajustes ya se estén pidiendo', async () => {
    const u = await makeUser('voice-speed');
    session.user = { id: u.id, email: u.email, role: 'owner', actingUser: null, team: null };
    const form = new FormData();
    form.append('context', 'chat');
    const res = await dictateRoute.POST(new Request('http://t/api/voice/dictate', { method: 'POST', body: form }) as never);
    expect(res.status).toBe(400);
  });
});

describe('ajustes y diccionario del dictado, guardados un rato', () => {
  it('se reusan y se olvidan al cambiar los ajustes o el diccionario', async () => {
    const u = await makeUser('voice-speed');
    const owner = voiceOwner({ id: u.id, role: 'owner' });
    const first = await getDictationProfile(owner);
    expect(await getDictationProfile(owner)).toBe(first);
    await saveVoiceSettings(owner, { language: 'es' });
    const afterSettings = await getDictationProfile(owner);
    expect(afterSettings.settings.language).toBe('es');
    await addDictionaryEntry(owner, { kind: 'word', phrase: 'Turso' });
    expect((await getDictationProfile(owner)).dictionary.map((d) => d.phrase)).toEqual(['Turso']);
  });

  it('vencen solos', async () => {
    const u = await makeUser('voice-speed');
    const owner = voiceOwner({ id: u.id, role: 'owner' });
    const first = await getDictationProfile(owner, 1_000);
    expect(await getDictationProfile(owner, 1_000 + 60_000)).not.toBe(first);
  });
});
