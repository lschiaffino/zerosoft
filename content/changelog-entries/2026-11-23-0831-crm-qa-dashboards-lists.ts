import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0831-crm-qa-dashboards-lists',
  date: '2026-11-23',
  title: {
    en: 'CRM: tidier dashboard KPIs and list toolbars',
    es: 'CRM: KPI de los dashboards y barras de los listados más prolijos',
    pt: 'CRM: KPIs dos dashboards e barras das listagens mais organizados',
  },
  items: [
    {
      product: 'crm',
      en: 'Dashboard KPI numbers line up in a row, keep their period on a phone and no longer stretch while loading. The dashboard switcher uses the app font and icons. The date filter has room for the whole From and To dates, Add company in the preview uses the regular field, Add stage is easier to tap, and on a phone the active view tab shows its full name, the quick filter settings stay next to Advanced filters, and the feedback tab no longer covers lists and dashboards (send feedback from the account menu).',
      es: 'Los números de los KPI de los dashboards quedan alineados en una fila, conservan su período en el teléfono y ya no se estiran mientras cargan. El selector de dashboards usa la letra y los íconos de la app. El filtro de fechas tiene lugar para Desde y Hasta enteros, Agregar empresa en la vista previa usa el campo de siempre, Agregar etapa es más fácil de tocar, y en el teléfono la pestaña de la vista activa muestra su nombre entero, el ajuste de filtros rápidos queda al lado de Filtros avanzados y la pestaña de feedback ya no tapa listados ni dashboards (el feedback se manda desde el menú de la cuenta).',
      pt: 'Os números dos KPIs dos dashboards ficam alinhados numa linha, mantêm o período no celular e não se esticam mais enquanto carregam. O seletor de dashboards usa a fonte e os ícones do app. O filtro de datas tem espaço para De e Até inteiros, Adicionar empresa na prévia usa o campo de sempre, Adicionar etapa é mais fácil de tocar, e no celular a aba da visualização ativa mostra o nome inteiro, o ajuste de filtros rápidos fica ao lado de Filtros avançados e a aba de feedback não cobre mais listagens nem dashboards (o feedback é enviado pelo menu da conta).',
    },
  ],
} satisfies ChangelogEntry;
