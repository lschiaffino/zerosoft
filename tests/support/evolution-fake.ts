import { deflateSync } from 'zlib';

/**
 * Un Evolution API v2.3 simulado con datos realistas para probar la
 * importación: 1:1 con teléfono y con "@lid", grupos con muchos miembros,
 * mensajes propios (fromMe, "Você"), nombres solo en pushName, media (foto,
 * nota de voz, documento, video, sticker), respuestas, reacciones, ediciones
 * y borrados. Lo usan los tests unitarios (fetch simulado) y los e2e (un
 * servidor HTTP en PORT + 31). Todo inventado: ningún dato real.
 */

export interface FakeChat {
  remoteJid: string;
  remoteJidAlt?: string;
  name: string;
  isGroup: boolean;
  unread: number;
  pic: boolean;
  messages: Array<Record<string, unknown>>;
}

export interface FakeEvolution {
  chats: FakeChat[];
  groups: Array<{ id: string; subject: string; size: number; participants: Array<{ id: string; phoneNumber?: string; admin: string | null }> }>;
  contacts: Array<{ remoteJid: string; pushName: string; profilePicUrl: string | null }>;
}

const FIRST = ['Lucía', 'Martín', 'Sofía', 'Juan', 'Valentina', 'Mateo', 'Camila', 'Benjamín', 'Julieta', 'Tomás', 'Ana', 'Pedro', 'Carla', 'Diego', 'Paula'];
const LAST = ['García', 'Pérez', 'López', 'Romero', 'Sosa', 'Díaz', 'Álvarez', 'Torres', 'Ruiz', 'Flores'];
const LINES = [
  '¿Me confirman el turno de mañana?',
  'Perfecto, gracias!',
  'Te paso la factura en un rato',
  'Ya hice la transferencia',
  '¿A qué hora abren el sábado?',
  'Dale, quedamos así',
  'Buen día! Una consulta sobre el pedido',
  'Llegó todo bien 👍',
  'Mándame la ubicación porfa',
  'Mañana lo reviso y te aviso',
];

/** Hora base fija: los mensajes quedan entre hace 30 días y hace 1 hora. */
export function buildEvolutionData(opts: { chats?: number; groups?: number; perChat?: number; now?: number } = {}): FakeEvolution {
  const nChats = opts.chats ?? 200;
  const nGroups = opts.groups ?? 12;
  const perChat = opts.perChat ?? 8;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const chats: FakeChat[] = [];
  const contacts: FakeEvolution['contacts'] = [];
  const groups: FakeEvolution['groups'] = [];
  let n = 0;
  const id = () => `3EB0${(++n).toString(16).toUpperCase().padStart(16, '0')}`;

  for (let i = 0; i < nChats; i++) {
    const phone = `54911${String(40000000 + i * 7919).slice(-8)}`;
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
    // Uno de cada 15 chats llega con id "@lid" y el teléfono en remoteJidAlt.
    const lid = i % 15 === 7;
    const remoteJid = lid ? `${190000000000000 + i}@lid` : `${phone}@s.whatsapp.net`;
    const last = now - 3600 - i * 3 * 3600;
    const messages: Array<Record<string, unknown>> = [];
    for (let k = 0; k < perChat; k++) {
      const ts = last - (perChat - 1 - k) * 600;
      const fromMe = k % 3 === 1;
      const key: Record<string, unknown> = { id: id(), fromMe, remoteJid, ...(lid ? { remoteJidAlt: `${phone}@s.whatsapp.net`, addressingMode: 'lid' } : {}) };
      let message: Record<string, unknown> = { conversation: LINES[(i + k) % LINES.length] };
      let messageType = 'conversation';
      if (k === 2 && i % 10 === 0) {
        message = { imageMessage: { caption: 'Foto del pedido', mimetype: 'image/jpeg', fileLength: { low: 48_000, high: 0, unsigned: true }, url: 'https://mmg.whatsapp.net/x' } };
        messageType = 'imageMessage';
      } else if (k === 3 && i % 10 === 1) {
        message = { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 7, ptt: true, fileLength: '12000' } };
        messageType = 'audioMessage';
      } else if (k === 4 && i % 10 === 2) {
        message = { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'presupuesto.pdf', mimetype: 'application/pdf', pageCount: 3, fileLength: 230_000, caption: 'Te paso el presupuesto' } } } };
        messageType = 'documentWithCaptionMessage';
      } else if (k === 5 && i % 10 === 3) {
        message = { videoMessage: { mimetype: 'video/mp4', seconds: 12, fileLength: 900_000 } };
        messageType = 'videoMessage';
      } else if (k === 5 && i % 10 === 4) {
        message = { stickerMessage: { mimetype: 'image/webp' } };
        messageType = 'stickerMessage';
      }
      const rec: Record<string, unknown> = {
        id: `row-${n}`,
        key,
        // Evolution guarda "Você" en lo propio y, sin nombre, los dígitos.
        pushName: fromMe ? 'Você' : i % 6 === 5 ? phone : name,
        messageType,
        message,
        messageTimestamp: ts,
        contextInfo: null,
        source: 'android',
        MessageUpdate: fromMe ? [{ status: k % 2 ? 'READ' : 'DELIVERY_ACK' }] : [],
      };
      // Una respuesta citando el mensaje anterior (Evolution saca el contextInfo afuera).
      if (k === perChat - 1 && messages.length) rec.contextInfo = { stanzaId: (messages[messages.length - 1].key as { id: string }).id, quotedMessage: { conversation: 'x' } };
      messages.push(rec);
    }
    chats.push({ remoteJid, remoteJidAlt: lid ? `${phone}@s.whatsapp.net` : undefined, name, isGroup: false, unread: i % 9 === 0 ? 2 : 0, pic: i % 4 === 0, messages });
    if (i % 5 === 0) contacts.push({ remoteJid: `${phone}@s.whatsapp.net`, pushName: `${name} (agenda)`, profilePicUrl: null });
  }

  for (let g = 0; g < nGroups; g++) {
    const gid = `1203630${String(10000000000 + g).slice(-11)}@g.us`;
    const subject = `Clientes zona ${g + 1}`;
    const size = g === 0 ? 180 : 6 + g;
    const participants = Array.from({ length: size }, (_, p) => {
      const phone = `54911${String(60000000 + g * 1000 + p).slice(-8)}`;
      // La mitad llega solo con lid (sin teléfono a la vista), como en Baileys 7.
      return p % 2 ? { id: `${170000000000000 + g * 1000 + p}@lid`, phoneNumber: `${phone}@s.whatsapp.net`, admin: p === 1 ? 'superadmin' : null } : { id: `${phone}@s.whatsapp.net`, admin: null };
    });
    groups.push({ id: gid, subject, size, participants });
    const last = now - 1800 - g * 5400;
    const messages: Array<Record<string, unknown>> = [];
    for (let k = 0; k < perChat; k++) {
      const p = participants[(k * 7) % participants.length];
      const fromMe = k === 2;
      const key: Record<string, unknown> = {
        id: id(),
        fromMe,
        remoteJid: gid,
        ...(fromMe ? {} : { participant: p.id, ...(p.phoneNumber ? { participantAlt: p.phoneNumber } : {}) }),
      };
      messages.push({
        id: `row-${n}`,
        key,
        pushName: fromMe ? 'Você' : `${FIRST[(k + g) % FIRST.length]} G${g}`,
        messageType: 'conversation',
        message: { conversation: `${LINES[(k + g) % LINES.length]} (grupo)` },
        messageTimestamp: last - (perChat - 1 - k) * 300,
        contextInfo: null,
        MessageUpdate: [],
      });
    }
    // Una reacción y una edición en el historial.
    const target = messages[1].key as { id: string };
    messages.push({ key: { id: id(), fromMe: false, remoteJid: gid, participant: participants[0].id }, pushName: 'X', messageType: 'reactionMessage', message: { reactionMessage: { key: { id: target.id }, text: '❤️' } }, messageTimestamp: last + 5 });
    chats.push({ remoteJid: gid, name: subject, isGroup: true, unread: g === 0 ? 5 : 0, pic: g % 2 === 0, messages });
  }
  return { chats, groups, contacts };
}

/** PNG de un color con un degradé suave (fotos de perfil y fotos de ejemplo sin archivos reales). */
export function fakePng(w: number, h: number, seed: number): Buffer {
  const hue = (seed * 47) % 360;
  const rgb = (l: number) => {
    const c = (1 - Math.abs(2 * l - 1)) * 0.45;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return [r + m, g + m, b + m].map((v) => Math.round(v * 255));
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(0.45 + 0.25 * ((x + y) / (w + h)));
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PHOTO = fakePng(320, 240, 3);

/**
 * Respuesta de Evolution para un pedido (path + cuerpo JSON). `base` es el
 * origen del simulado (para las URLs de fotos). null si no es de importación.
 */
export function evolutionImportResponse(
  data: FakeEvolution,
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  base: string,
): { status: number; json?: unknown; bytes?: Buffer; type?: string } | null {
  const sorted = () => [...data.chats].sort((a, b) => lastTs(b) - lastTs(a));
  if (method === 'POST' && path.startsWith('/chat/findChats/')) {
    const take = Number(body?.take ?? 0) || data.chats.length;
    const skip = Number(body?.skip ?? 0);
    const rows = sorted()
      .slice(skip, skip + take)
      .map((c) => {
        const last = c.messages.filter((m) => m.messageType !== 'reactionMessage').at(-1)!;
        return {
          id: null,
          remoteJid: c.remoteJid,
          // Evolution pisa pushName con Chat.name: casi siempre null en los 1:1.
          pushName: c.isGroup ? c.name : null,
          profilePicUrl: null,
          updatedAt: new Date(Number(last.messageTimestamp) * 1000).toISOString(),
          lastMessage: { ...last, message: last.message },
          unreadCount: c.unread || null,
          isSaved: false,
        };
      });
    return { status: 200, json: rows };
  }
  if (method === 'POST' && path.startsWith('/chat/findMessages/')) {
    const remoteJid = String(((body?.where as { key?: { remoteJid?: string } } | undefined)?.key ?? {}).remoteJid ?? '');
    const offset = Number(body?.offset ?? 50);
    const chat = data.chats.find((c) => c.remoteJid === remoteJid);
    const all = (chat?.messages ?? []).slice().sort((a, b) => Number(b.messageTimestamp) - Number(a.messageTimestamp));
    return { status: 200, json: { messages: { total: all.length, pages: Math.ceil(all.length / offset), currentPage: 1, records: all.slice(0, offset) } } };
  }
  if (method === 'POST' && path.startsWith('/chat/findContacts/')) {
    const size = Number(body?.offset ?? 0) || data.contacts.length;
    const page = Math.max(1, Number(body?.page ?? 1));
    return { status: 200, json: data.contacts.slice((page - 1) * size, page * size).map((c) => ({ ...c, isGroup: false, isSaved: true, type: 'contact' })) };
  }
  if (method === 'POST' && path.startsWith('/chat/fetchProfilePictureUrl/')) {
    const jid = String(body?.number ?? '');
    const chat = data.chats.find((c) => c.remoteJid === jid || c.remoteJidAlt === jid);
    return { status: 200, json: { wuid: jid, profilePictureUrl: chat?.pic ? `${base}/pps/${encodeURIComponent(jid)}.png` : null } };
  }
  if (method === 'GET' && path.startsWith('/pps/')) return { status: 200, bytes: fakePng(48, 48, path.length * 7 + path.charCodeAt(10)), type: 'image/png' };
  if (method === 'GET' && path.startsWith('/group/fetchAllGroups/')) {
    return { status: 200, json: data.groups.map((g) => ({ id: g.id, subject: g.subject, size: g.size, announce: false, restrict: false, ...(query.get('getParticipants') === 'true' ? { participants: g.participants } : {}) })) };
  }
  if (method === 'GET' && path.startsWith('/group/participants/')) {
    const g = data.groups.find((x) => x.id === query.get('groupJid'));
    return { status: 200, json: { participants: g?.participants ?? [] } };
  }
  if (method === 'POST' && path.startsWith('/chat/getBase64FromMediaMessage/')) {
    return { status: 201, json: { mediaType: 'imageMessage', fileName: 'foto.png', mimetype: 'image/png', base64: PHOTO.toString('base64') } };
  }
  return null;
}

function lastTs(c: FakeChat): number {
  return Math.max(...c.messages.map((m) => Number(m.messageTimestamp)));
}
