import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { ProviderError } from '@/lib/groups-provider';
import { parseRange, rangedResponse } from '@/lib/byte-range';
import { fetchStateOf, gatewayReason, logMediaFailure, mediaErrorKind, mediaWireOf } from '@/lib/wa-media-wire';
import { openWire, sealWire } from '@/lib/wa-media-wire-seal';
import { readMediaRef, storedMediaRef } from '@/lib/inbox/whatsapp';
import { readTranscript, transcribeMessage } from '@/lib/wa-extras';

/**
 * Archivos de WhatsApp que se vuelven a bajar: qué dice la pantalla según por
 * qué falló, la clave del archivo cifrada en la base, el audio con Range y la
 * transcripción que se reintenta cuando el audio vuelve. Datos inventados.
 */

const KEY = Buffer.alloc(32, 7).toString('base64');
const AUDIO = {
  mimetype: 'audio/ogg; codecs=opus',
  fileLength: '9000',
  mediaKey: KEY,
  directPath: '/v/t62.7117-24/11111_22222.enc?ccb=11-4&oh=abc&oe=def',
  url: 'https://mmg.whatsapp.net/v/t62.7117-24/11111_22222.enc?ccb=11-4',
};

describe('por qué falló (lo que ve la pantalla)', () => {
  it('lee el motivo del gateway sin guardar el texto', () => {
    expect(gatewayReason('{"status":400,"response":{"message":["Message not found"]}}')).toBe('message_not_found');
    expect(gatewayReason('Error: Connection Closed')).toBe('offline');
    expect(gatewayReason('Precondition Required')).toBe('offline');
    expect(gatewayReason('Media re-upload failed by device (404)')).toBe('media_gone');
    expect(gatewayReason('Request timed out')).toBe('timeout');
    expect(gatewayReason('')).toBeUndefined();
    expect(gatewayReason('anything else')).toBeUndefined();
  });

  it('desconectada no es "ya no está"; un 400 sin motivo y con clave se puede reintentar', () => {
    const offline = new ProviderError('provider_error', 400);
    offline.reason = 'offline';
    expect(fetchStateOf(mediaErrorKind(offline))).toBe('offline');
    const slow = new ProviderError('provider_error', 400);
    slow.reason = 'timeout';
    expect(fetchStateOf(mediaErrorKind(slow, true))).toBe('pending');
    expect(fetchStateOf(mediaErrorKind(new ProviderError('provider_error', 400), true))).toBe('pending');
    expect(fetchStateOf(mediaErrorKind(new ProviderError('provider_error', 400), false))).toBe('gone');
    expect(fetchStateOf(mediaErrorKind(new ProviderError('not_found')))).toBe('gone');
    expect(fetchStateOf(mediaErrorKind(new ProviderError('unreachable')))).toBe('pending');
  });

  it('con la línea desvinculada, cualquier falla es "sin conexión"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(logMediaFailure('inbox', new ProviderError('not_found'), false, false)).toBe('offline');
    expect(logMediaFailure('inbox', new ProviderError('not_found'), false, true)).toBe('gone');
    // El log lleva solo el tipo: ni ids ni texto.
    expect(warn.mock.calls.every((c) => /^\{"app":"inbox","kind":"(offline|gone)","wire":false\}$/.test(String(c[1])))).toBe(true);
    warn.mockRestore();
  });
});

describe('la clave del archivo, cifrada en la base', () => {
  it('mediaKey no queda en claro y se vuelve a leer igual', () => {
    const wire = mediaWireOf('audioMessage', AUDIO)!;
    const stored = JSON.stringify(sealWire(wire));
    expect(stored).not.toContain(KEY);
    expect(stored).toContain('enc:v');
    expect(openWire(JSON.parse(stored))).toEqual(wire);
  });

  it('lo guardado en claro (antes) se sigue leyendo', () => {
    const wire = mediaWireOf('audioMessage', AUDIO)!;
    expect(openWire(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
    expect(openWire({ ...wire, mediaKey: 'enc:v1:roto' })).toBeUndefined();
    expect(openWire(null)).toBeUndefined();
  });

  it('la referencia de Inbox entra en la columna aunque la URL sea larga', () => {
    const long = { ...AUDIO, url: `https://mmg.whatsapp.net/${'a'.repeat(1900)}`, directPath: `/${'b'.repeat(990)}` };
    const wire = mediaWireOf('audioMessage', long)!;
    const ref = storedMediaRef({ providerMessageId: 'A1', chatId: '15550001111@s.whatsapp.net', fromMe: false, wire });
    expect(ref.length).toBeLessThan(4000);
    const back = readMediaRef(ref)!;
    expect(back.providerMessageId).toBe('A1');
    expect(back.wire?.mediaKey).toBe(KEY);
    expect(back.wire?.directPath).toBe(long.directPath);
    expect(readMediaRef('{"providerMessageId":"A1","chatId":"x","fromMe":true}')).toEqual({ providerMessageId: 'A1', chatId: 'x', fromMe: true });
    expect(readMediaRef('no es json')).toBeNull();
  });
});

describe('evolutionProvider.fetchMedia', () => {
  function provider(replies: Array<() => Response>) {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return replies[bodies.length - 1]();
    });
    return { p: evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' }, { fetch: fetch as never }), bodies };
  }
  const closed = () => new Response(JSON.stringify({ status: 400, response: { message: ['Error: Connection Closed'] } }), { status: 400 });
  const notFound = () => new Response(JSON.stringify({ status: 400, response: { message: ['Message not found'] } }), { status: 400 });
  const reupload = () => new Response(JSON.stringify({ status: 400, response: { message: ['Media re-upload failed by device (404)'] } }), { status: 400 });
  const ref = { providerMessageId: 'A2', chatId: '15550001111@s.whatsapp.net', fromMe: false, wire: mediaWireOf('audioMessage', AUDIO)! };

  it('con la sesión cerrada no insiste con la clave y avisa "sin conexión"', async () => {
    const { p, bodies } = provider([closed, closed]);
    const err = await p.fetchMedia!(ref, 1024 * 1024).catch((e) => e);
    expect(bodies).toHaveLength(1);
    expect(fetchStateOf(mediaErrorKind(err, true))).toBe('offline');
  });

  it('el teléfono ya no lo tiene: "ya no está"', async () => {
    const { p, bodies } = provider([notFound, reupload]);
    const err = await p.fetchMedia!(ref, 1024 * 1024).catch((e) => e);
    expect(bodies).toHaveLength(2);
    expect(fetchStateOf(mediaErrorKind(err, true))).toBe('gone');
  });
});

describe('Range', () => {
  const data = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
  const get = (range?: string) => rangedResponse(new Request('https://x.test/a', { headers: range ? { range } : {} }), data, { 'content-type': 'audio/ogg' });

  it('entero sin Range, con Accept-Ranges', async () => {
    const r = get();
    expect(r.status).toBe(200);
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('content-length')).toBe('100');
    expect((await r.arrayBuffer()).byteLength).toBe(100);
  });

  it('206 con el tramo pedido (también "0-", el del final y el que se pasa)', async () => {
    const r = get('bytes=10-19');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 10-19/100');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(get('bytes=0-').status).toBe(206);
    expect(get('bytes=0-').headers.get('content-range')).toBe('bytes 0-99/100');
    expect(get('bytes=-5').headers.get('content-range')).toBe('bytes 95-99/100');
    expect(get('bytes=90-500').headers.get('content-range')).toBe('bytes 90-99/100');
  });

  it('416 fuera del archivo; lo que no se entiende va entero', () => {
    expect(get('bytes=100-').status).toBe(416);
    expect(get('bytes=100-').headers.get('content-range')).toBe('bytes */100');
    expect(get('bytes=5-2').status).toBe(416);
    expect(get('bytes=0-1,5-6').status).toBe(200);
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});

describe('transcripción cuando el audio vuelve', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lo que falló porque el audio no estaba se reintenta; lo demás queda', async () => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
    const owner = `u_${Math.random().toString(36).slice(2)}`;
    const id = `m_${Math.random().toString(36).slice(2)}`;
    const missing = async () => {
      throw new Error('media_unavailable');
    };
    const first = await transcribeMessage('inbox', owner, id, missing);
    expect(first).toMatchObject({ status: 'failed', error: 'media_unavailable' });

    // Enseguida no se vuelve a pedir (un audio que no está no se pide en cada vista)…
    let loads = 0;
    const audio = async () => {
      loads++;
      return { data: Buffer.from('RIFF....WAVE'), mimetype: 'audio/wav', seconds: 2 };
    };
    expect(await transcribeMessage('inbox', owner, id, audio)).toMatchObject({ status: 'failed', error: 'media_unavailable' });
    expect(loads).toBe(0);
    // …salvo que el audio se acabe de bajar (force), o que haya pasado el intervalo.
    const again = await transcribeMessage('inbox', owner, id, audio, new Date(), { force: true });
    expect(loads).toBe(1);
    expect(again.status).not.toBe('pending');
    expect(again.error).not.toBe('media_unavailable');

    // Una falla que no es del audio no se reintenta sola.
    const other = `m_${Math.random().toString(36).slice(2)}`;
    await transcribeMessage('inbox', owner, other, missing);
    await getDb().prepare("UPDATE wa_transcripts SET error = 'audio_too_large' WHERE scope = 'inbox' AND owner_id = ? AND message_id = ?").run(owner, other);
    await transcribeMessage('inbox', owner, other, audio, new Date(Date.now() + 3_600_000), { force: true });
    expect(loads).toBe(1);
    expect((await readTranscript('inbox', owner, other))?.error).toBe('audio_too_large');
  });

  it('pasado el intervalo, se reintenta solo', async () => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
    const owner = `u_${Math.random().toString(36).slice(2)}`;
    const id = `m_${Math.random().toString(36).slice(2)}`;
    await transcribeMessage('inbox', owner, id, async () => {
      throw new Error('media_unavailable');
    });
    let loads = 0;
    await transcribeMessage(
      'inbox',
      owner,
      id,
      async () => {
        loads++;
        return { data: Buffer.from('RIFF....WAVE'), mimetype: 'audio/wav', seconds: 2 };
      },
      new Date(Date.now() + 11 * 60_000),
    );
    expect(loads).toBe(1);
  });
});
