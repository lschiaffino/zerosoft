import { getDb } from '@/lib/db';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listObjects, objectEntity } from '@/lib/crm-objects';
import { ownerScopeSql } from '@/lib/crm-visibility';
import { sessionScope } from '@/lib/crm-visibility';
import ObjectsIndex, { type ObjectRow } from '@/components/crm/ObjectsIndex';

export const dynamic = 'force-dynamic';

/** Objetos propios del workspace con su cantidad de registros (los visibles) y propiedades. */
export default async function ObjectsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const [objects, scope] = await Promise.all([listObjects(user.id), sessionScope(user)]);
  const db = getDb();
  const visible = ownerScopeSql('r', scope);
  const rows: ObjectRow[] = await Promise.all(
    objects.map(async (o) => {
      const [records, props] = await Promise.all([
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM crm_object_records r WHERE r.user_id = ? AND r.object_id = ?${visible.sql ? ` AND ${visible.sql}` : ''}`,
          )
          .get(user.id, o.id, ...visible.args) as Promise<{ n: number }>,
        db
          .prepare('SELECT COUNT(*) AS n FROM crm_custom_fields WHERE user_id = ? AND entity = ?')
          .get(user.id, objectEntity(o.id)) as Promise<{ n: number }>,
      ]);
      return {
        id: o.id,
        slug: o.slug,
        singular: o.singular,
        plural: o.plural,
        description: o.description,
        records: records.n,
        properties: props.n,
      };
    }),
  );
  return (
    <div className="app-page">
      <ObjectsIndex rows={rows} canAdmin={isWorkspaceAdmin(user)} />
    </div>
  );
}
