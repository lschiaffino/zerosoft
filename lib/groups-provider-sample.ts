/**
 * Groups: el número de los datos de ejemplo. Está "conectado" siempre y no
 * sale nunca a la red: responder, mandar, crear grupos y los envíos masivos
 * devuelven un id propio y quedan guardados como hechos. Los miembros salen
 * de la base (no hay WhatsApp que preguntar). No acepta webhooks.
 */
import { randomBytes, randomUUID } from 'crypto';
import { getDb } from './db';
import { PROVIDER_CAPS, ProviderError, phoneDigits, type GroupsProvider, type MemberRole } from './groups-provider';

/** El teléfono del número de ejemplo (no es de nadie: prefijo de ficción). */
export const SAMPLE_PHONE = '5491100000000';

const sid = () => `sample-${randomUUID()}`;

export function sampleProvider(numberId: string): GroupsProvider {
  const db = () => getDb();
  async function members(groupId: string): Promise<Array<{ phone: string; role: MemberRole; name?: string }>> {
    return (await db()
      .prepare(
        `SELECT m.phone, m.role, m.name FROM groups_members m JOIN groups_chats c ON c.id = m.chat_id
         WHERE c.number_id = ? AND c.provider_chat_id = ? ORDER BY m.created_at`,
      )
      .all(numberId, groupId)) as Array<{ phone: string; role: MemberRole; name: string }>;
  }
  const done = async () => ({ id: sid() });
  return {
    kind: 'sample',
    caps: PROVIDER_CAPS.sample,
    connect: async () => ({ status: 'connected', phone: SAMPLE_PHONE }),
    state: async () => ({ status: 'connected', phone: SAMPLE_PHONE }),
    disconnect: async () => undefined,
    sendText: done,
    sendMedia: done,
    sendPoll: done,
    react: async () => undefined,
    sendTemplate: async () => {
      throw new ProviderError('unsupported');
    },
    listTemplates: async () => [],
    async listGroups() {
      const rows = (await db()
        .prepare("SELECT provider_chat_id AS id, name, description, announce, locked FROM groups_chats WHERE number_id = ? AND kind = 'group' AND left_at IS NULL")
        .all(numberId)) as Array<{ id: string; name: string; description: string; announce: number; locked: number }>;
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, announce: Boolean(r.announce), locked: Boolean(r.locked) }));
    },
    async createGroup(name, phones) {
      const id = `sample-${randomBytes(8).toString('hex')}@g.us`;
      return {
        id,
        name,
        participants: [{ phone: SAMPLE_PHONE, role: 'superadmin' as const }, ...phones.map((p) => ({ phone: phoneDigits(p), role: 'member' as const }))],
      };
    },
    participants: async (groupId) => (await members(groupId)).map((m) => ({ phone: m.phone, role: m.role, name: m.name || undefined })),
    updateParticipants: async (_groupId, _action, phones) => phones.map((p) => ({ phone: phoneDigits(p), ok: true })),
    // Los códigos reales de WhatsApp no llevan guiones: este link no abre ningún grupo de verdad.
    inviteLink: async () => `https://chat.whatsapp.com/sample-${randomBytes(6).toString('hex')}`,
    updateGroup: async () => undefined,
    editMessage: async () => undefined,
    deleteMessage: async () => undefined,
    pinMessage: async () => undefined,
    forwardMessage: done,
    updateGroupSettings: async () => undefined,
    setGroupPicture: async () => undefined,
    joinGroup: async () => ({ id: `sample-${randomBytes(8).toString('hex')}@g.us` }),
    leaveGroup: async () => undefined,
    verifyWebhook: () => false,
    parseWebhook: () => [],
  };
}
