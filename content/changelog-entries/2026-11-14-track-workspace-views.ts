import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-track-workspace-views',
  date: '2026-11-14',
  title: {
    en: 'Track: saved views shared with the whole workspace',
    es: 'Track: vistas guardadas compartidas con todo el workspace',
    pt: 'Track: visualizações salvas compartilhadas com todo o workspace',
  },
  items: [
    {
      product: 'track',
      en: 'Views saved on Issues or on a project\'s Issues tab can now be shared with the workspace, when you save them or later from Saved views. Everyone in the workspace finds them in that list with the owner\'s name and sees the issues they have access to. Only the owner edits, unshares or deletes a view. Views on My issues stay personal. On a phone, the Saved views menu now opens at the bottom of the screen. Before, it opened below the screen edge.',
      es: 'Las vistas guardadas en Issues o en la pestaña Issues de un project ahora se pueden compartir con el workspace, al guardarlas o después desde Vistas guardadas. Todo el workspace las encuentra en esa lista con el nombre de quien la creó y ve los issues a los que tiene acceso. Solo quien la creó la edita, la deja de compartir o la borra. Las vistas de Mis issues siguen siendo personales. En el teléfono, el menú de Vistas guardadas ahora se abre abajo de la pantalla. Antes se abría debajo del borde.',
      pt: 'As visualizações salvas em Issues ou na aba Issues de um project agora podem ser compartilhadas com o workspace, ao salvar ou depois em Visualizações salvas. Todo o workspace as encontra nessa lista com o nome de quem criou e vê os issues a que tem acesso. Só quem criou edita, deixa de compartilhar ou apaga. As visualizações de Meus issues continuam pessoais. No celular, o menu de Visualizações salvas agora abre na parte de baixo da tela. Antes abria abaixo da borda.',
    },
  ],
} satisfies ChangelogEntry;
