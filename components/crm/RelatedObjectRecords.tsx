import { getTranslations } from 'next-intl/server';
import { midSentence } from '@/lib/crm-object-text';
import { listObjects, listRecords, recordsLinkedTo, type ObjectLinkEntity } from '@/lib/crm-objects';
import { filterByScope, type OwnerScope } from '@/lib/crm-visibility';
import AssociationPanel from './AssociationPanel';
import RecordCard from './RecordCard';
import { linkFromEntity, unlinkFromEntity } from './objectActions';

/**
 * Registros de objetos propios asociados a un contacto, empresa o deal: una
 * tarjeta plegable por objeto en la columna de asociaciones. Sin objetos no
 * muestra nada.
 */
export default async function RelatedObjectRecords({
  workspaceId,
  entity,
  entityId,
  scope,
  locale,
}: {
  workspaceId: string;
  entity: ObjectLinkEntity;
  entityId: string;
  scope: OwnerScope;
  locale: string;
}) {
  const objects = await listObjects(workspaceId);
  if (!objects.length) return null;
  const t = await getTranslations({ locale, namespace: 'crm' });
  const linked = filterByScope(await recordsLinkedTo(workspaceId, entity, entityId), scope);
  const blocks = await Promise.all(
    objects.map(async (o) => {
      const mine = linked.filter((r) => r.object_id === o.id);
      const { rows } = await listRecords(workspaceId, o.id, { ownerScope: scope, sort: 'name', pageSize: 100 });
      return { o, mine, options: rows.filter((r) => !mine.some((m) => m.id === r.id)) };
    }),
  );
  return (
    <>
      {blocks.map(({ o, mine, options }) => (
        <RecordCard
          key={o.id}
          id={`${entity}.object.${o.slug}`}
          label={t('objects.relatedTitle', { plural: o.plural })}
          count={mine.length}
          addLabel={options.length > 0 ? t('record.cards.add') : undefined}
          testId={`related-object-${o.slug}`}
        >
          <AssociationPanel
            records={mine.map((r) => ({ id: r.id, name: r.name, href: `/app/crm/objects/${o.slug}/${r.id}` }))}
            options={options.map((r) => ({ id: r.id, value: r.name }))}
            onAssociate={linkFromEntity.bind(null, entity, entityId)}
            onRemove={unlinkFromEntity.bind(null, entity, entityId)}
            addLabel={t('objects.pickRecord', { singular: midSentence(o.singular, locale) })}
            emptyLabel={t('objects.noRecords', { plural: midSentence(o.plural, locale) })}
          />
        </RecordCard>
      ))}
    </>
  );
}
