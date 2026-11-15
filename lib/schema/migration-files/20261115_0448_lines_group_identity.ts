import type { Migration } from '../migrations';
import { groupIdentityUp } from '../group-identity-migration';

/**
 * Lines: el mismo grupo de WhatsApp en varias líneas es un solo grupo
 * (workspace + JID), con una sola empresa de HubSpot
 * (lib/schema/group-identity-migration.ts, lib/groups-identity.ts).
 */
export default {
  id: '20261115_0448_lines_group_identity',
  up: groupIdentityUp,
} satisfies Migration;
