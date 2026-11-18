import type { Migration } from '../migrations';

/**
 * El mismo chat en varias líneas (Lines) o cuentas (Inbox), listado una vez
 * (lib/same-chat.ts). La bandeja busca, para los chats de cada página, sus
 * filas en las otras líneas: el 1:1 por teléfono y el grupo por su JID. El
 * grupo de Lines ya tiene idx_groups_chats_jid; estos índices cubren el resto
 * para que esa búsqueda no recorra todos los chats del workspace.
 */
export default {
  id: '20261118_1225_same_chat_lines',
  up: async (c) => {
    await c.execute("CREATE INDEX IF NOT EXISTS idx_groups_chats_dm_phone ON groups_chats(user_id, phone) WHERE kind = 'dm'");
    await c.execute("CREATE INDEX IF NOT EXISTS idx_groups_chats_dm_jid ON groups_chats(user_id, provider_chat_id) WHERE kind = 'dm' AND phone = ''");
    await c.execute("CREATE INDEX IF NOT EXISTS idx_inbox_threads_same_handle ON inbox_threads(owner_id, handle) WHERE channel = 'whatsapp' AND kind = 'dm'");
    await c.execute("CREATE INDEX IF NOT EXISTS idx_inbox_threads_same_jid ON inbox_threads(owner_id, external_id) WHERE channel = 'whatsapp'");
  },
} satisfies Migration;
