import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-pulse-replay-trash',
  date: '2026-11-18',
  title: {
    en: 'Pulse: Recordings removed by the retention can be restored',
    es: 'Pulse: Las grabaciones que saca la retención se pueden restaurar',
    pt: 'Pulse: As gravações removidas pela retenção podem ser restauradas',
  },
  items: [
    {
      product: 'pulse',
      en: 'Session recordings near the end of their retention now go to a trash in the project settings instead of being deleted right away. The trash shows when each recording started, when it will be deleted for good, and a Restore button for admins. Recordings are still deleted for good on the same day as before, and nothing about the person or the pages is shown while they are in the trash. Deleting a person or a project also empties their part of the trash.',
      es: 'Las grabaciones de sesiones que llegan al final de su retención ahora pasan a una papelera en los ajustes del proyecto en vez de borrarse en el momento. La papelera muestra cuándo empezó cada grabación, cuándo se borra para siempre y un botón Restaurar para los admins. Las grabaciones se siguen borrando para siempre el mismo día que antes, y mientras están en la papelera no se ve nada de la persona ni de las páginas. Borrar una persona o un proyecto también vacía su parte de la papelera.',
      pt: 'As gravações de sessões que chegam ao fim da retenção agora vão para uma lixeira nos ajustes do projeto em vez de serem excluídas na hora. A lixeira mostra quando cada gravação começou, quando ela será excluída de vez e um botão Restaurar para os admins. As gravações continuam sendo excluídas de vez no mesmo dia de antes, e nada da pessoa nem das páginas aparece enquanto estão na lixeira. Excluir uma pessoa ou um projeto também esvazia a parte dela na lixeira.',
    },
  ],
} satisfies ChangelogEntry;
