import { getCurrentUser } from '@/lib/session';
import { crmLiveRev, type CrmLiveEntity } from '@/lib/crm-live';
import CrmLive from './CrmLive';

/**
 * CRM en vivo en una página del server: el contador del workspace va con la
 * página (una fila) y monta el cliente (components/crm/CrmLive.tsx). Con un
 * `record`, la ficha mira solo ese registro; con `entities`, la tabla o el
 * tablero miran todo lo de esas entidades.
 *
 * `rev`: conviene leerlo al empezar la página, antes que los datos (con
 * `startCrmLiveRev`): un cambio que entra mientras se arma la página queda
 * después del contador y la pantalla lo pide enseguida.
 */
export default async function CrmLiveMount({
  rev,
  entities,
  record,
  back,
}: {
  rev?: Promise<number>;
  entities?: CrmLiveEntity[];
  record?: { entity: CrmLiveEntity; id: string } | null;
  back?: { href: string; label: string };
}) {
  let value = rev ? await rev : null;
  if (value === null) {
    const user = await getCurrentUser();
    if (!user) return null;
    value = await startCrmLiveRev(user.id);
  }
  return <CrmLive rev={value} entities={entities} record={record} back={back} />;
}

/** El contador del workspace, sin fallar (sin la tabla todavía: 0). */
export function startCrmLiveRev(workspaceId: string): Promise<number> {
  return crmLiveRev(workspaceId).catch(() => 0);
}

const RECORD_ENTITY: Record<string, CrmLiveEntity> = {
  contacts: 'contact',
  companies: 'company',
  deals: 'deal',
  leads: 'lead',
};

/** `/app/crm/<entidad>/<id>` → el registro que mira la ficha. */
export function liveRecordOf(base: string): { entity: CrmLiveEntity; id: string } | null {
  const m = /^\/app\/crm\/(contacts|companies|deals|leads)\/([^/?#]+)$/.exec(base);
  return m ? { entity: RECORD_ENTITY[m[1]], id: m[2] } : null;
}
