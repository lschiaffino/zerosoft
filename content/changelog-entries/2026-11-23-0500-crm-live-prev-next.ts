import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0500-crm-live-prev-next',
  date: '2026-11-23',
  title: {
    en: 'CRM: teammates’ changes show up without reloading, and previous / next on the record',
    es: 'CRM: los cambios de otras personas aparecen sin recargar, y anterior / siguiente en la ficha',
    pt: 'CRM: as mudanças de outras pessoas aparecem sem recarregar, e anterior / próximo no registro',
  },
  items: [
    {
      product: 'crm',
      en: 'Contact, company, deal and lead tables, the deal and lead boards and record pages now pick up what someone else creates, edits, moves to another stage or deletes within a few seconds, without reloading. A field or cell you are editing, an open menu or dialog, or a card you are dragging is never replaced: the update waits until you finish, and your selection and scroll stay. If someone deletes the record you are looking at, the page says so and offers the way back. A contact, company or deal opened from its table has previous and next buttons in the header with its position in the view ("3 of 120"), following that table’s saved view, filters and sort; K and J move too.',
      es: 'Las tablas de contactos, empresas, deals y leads, los tableros de deals y leads y las fichas ahora muestran en unos segundos, sin recargar, lo que otra persona crea, edita, cambia de etapa o borra. Un campo o celda que estás editando, un menú o diálogo abierto o una card que estás arrastrando nunca se reemplaza: la actualización espera a que termines, y la selección y el scroll se mantienen. Si alguien borra el registro que estás mirando, la ficha lo avisa y ofrece volver. Un contacto, empresa o deal abierto desde su tabla tiene botones de anterior y siguiente en la cabecera con su posición en la vista ("3 de 120"), con la vista guardada, los filtros y el orden de esa tabla; K y J también recorren.',
      pt: 'As tabelas de contatos, empresas, negócios e leads, os quadros de negócios e leads e as páginas de registro agora mostram em alguns segundos, sem recarregar, o que outra pessoa cria, edita, muda de etapa ou exclui. Um campo ou célula que você está editando, um menu ou diálogo aberto ou um cartão que você está arrastando nunca é substituído: a atualização espera você terminar, e a seleção e a rolagem se mantêm. Se alguém excluir o registro que você está olhando, a página avisa e oferece voltar. Um contato, empresa ou negócio aberto a partir da sua tabela tem botões de anterior e próximo no cabeçalho com a sua posição na visualização ("3 de 120"), com a visualização salva, os filtros e a ordem dessa tabela; K e J também percorrem.',
    },
  ],
} satisfies ChangelogEntry;
