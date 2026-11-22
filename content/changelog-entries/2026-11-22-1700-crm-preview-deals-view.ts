import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1700-crm-preview-deals-view',
  date: '2026-11-22',
  title: {
    en: 'CRM: edit records from the preview, and a cleaner deals view',
    es: 'CRM: editá registros desde la vista previa, y una vista de deals más clara',
    pt: 'CRM: edite registros pela prévia, e uma visão de negócios mais clara',
  },
  items: [
    {
      product: 'crm',
      en: 'The side preview of a contact, company or deal now edits properties in place: click a value, press Enter or leave the field to save, Esc to cancel. The new value shows right away and goes back if the save fails. Read-only and hidden properties stay that way, as on the record page. Deals change stage from the preview, and Open record sits at the bottom. The deals view puts the pipeline and the board or table switch next to the search, adds quick filters for owner, create date, close date and last activity, and shows each column with its count, total and weighted amount, and each card with its close date and owner.',
      es: 'La vista previa de un contacto, empresa o deal ahora edita las propiedades ahí mismo: hacé click en un valor, guardá con Enter o saliendo del campo, y cancelá con Esc. El valor nuevo se ve al instante y vuelve si no se pudo guardar. Las propiedades de solo lectura y las ocultas siguen así, como en la ficha. Los deals cambian de etapa desde la vista previa, y Abrir registro queda abajo. La vista de deals pone el pipeline y el cambio entre board y tabla al lado de la búsqueda, suma filtros rápidos por propietario, fecha de creación, fecha de cierre y última actividad, y muestra cada columna con su cantidad, total y monto ponderado, y cada tarjeta con su fecha de cierre y su propietario.',
      pt: 'A prévia lateral de um contato, empresa ou negócio agora edita as propriedades ali mesmo: clique num valor, salve com Enter ou saindo do campo, e cancele com Esc. O valor novo aparece na hora e volta se não deu para salvar. As propriedades só leitura e as ocultas continuam assim, como no registro. Os negócios mudam de etapa pela prévia, e Abrir registro fica embaixo. A visão de negócios coloca o pipeline e a troca entre quadro e tabela ao lado da busca, adiciona filtros rápidos por responsável, data de criação, data de fechamento e última atividade, e mostra cada coluna com quantidade, total e valor ponderado, e cada cartão com a data de fechamento e o responsável.',
    },
  ],
} satisfies ChangelogEntry;
