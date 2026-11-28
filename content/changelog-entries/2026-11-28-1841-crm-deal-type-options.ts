import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-1841-crm-deal-type-options',
  date: '2026-11-28',
  title: {
    en: 'CRM: your own deal types',
    es: 'CRM: tus propios tipos de deal',
    pt: 'CRM: seus próprios tipos de negócio',
  },
  items: [
    {
      product: 'crm',
      en: 'Deal type options are now editable in Settings › Data, like lifecycle stage and lead status: add types such as Renewal or Upsell, rename New business, reorder or archive them. The deal page, preview, create form, board cards, filters, bulk edit and CSV import use your list, and a deal keeps an archived type.',
      es: 'Las opciones de tipo de deal ahora se editan en Ajustes › Datos, como lifecycle stage y lead status: sumá tipos como Renovación o Upsell, renombrá Negocio nuevo, ordenalos o archivalos. La ficha del deal, la vista previa, el formulario de alta, las tarjetas del board, los filtros, la edición en masa y el import CSV usan tu lista, y un deal conserva un tipo archivado.',
      pt: 'As opções de tipo de negócio agora são editadas em Ajustes › Dados, como lifecycle stage e lead status: adicione tipos como Renovação ou Upsell, renomeie Novo negócio, ordene ou arquive. A página do negócio, a prévia, o formulário de criação, os cartões do quadro, os filtros, a edição em massa e a importação CSV usam a sua lista, e um negócio mantém um tipo arquivado.',
    },
  ],
} satisfies ChangelogEntry;
