import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-forms-retention-trash',
  date: '2026-11-18',
  title: {
    en: 'Forms: Responses removed by the retention can be restored',
    es: 'Forms: Las respuestas que saca la retención se pueden restaurar',
    pt: 'Forms: As respostas removidas pela retenção podem ser restauradas',
  },
  items: [
    {
      product: 'forms',
      en: 'When a form keeps responses for a set number of days, responses near the end of that term now go to a trash in the form settings instead of being deleted right away. The trash shows the date of each response and when it will be deleted for good, and a Restore button. Responses are still deleted for good, with their files, on the same day as before, and their content stays hidden while they are in the trash. Partial responses abandoned for 30 days go through the same trash.',
      es: 'Cuando un formulario guarda las respuestas por una cantidad de días, las que llegan al final de ese plazo ahora pasan a una papelera en los ajustes del formulario en vez de borrarse en el momento. La papelera muestra la fecha de cada respuesta, cuándo se borra para siempre y un botón Restaurar. Las respuestas se siguen borrando para siempre, con sus archivos, el mismo día que antes, y su contenido no se ve mientras están en la papelera. Las respuestas parciales abandonadas hace 30 días pasan por la misma papelera.',
      pt: 'Quando um formulário guarda as respostas por um número de dias, as que chegam ao fim desse prazo agora vão para uma lixeira nos ajustes do formulário em vez de serem excluídas na hora. A lixeira mostra a data de cada resposta, quando ela será excluída de vez e um botão Restaurar. As respostas continuam sendo excluídas de vez, com seus arquivos, no mesmo dia de antes, e o conteúdo fica oculto enquanto estão na lixeira. As respostas parciais abandonadas há 30 dias passam pela mesma lixeira.',
    },
  ],
} satisfies ChangelogEntry;
