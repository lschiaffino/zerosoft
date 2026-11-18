import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-hiring-retention-trash',
  date: '2026-11-18',
  title: {
    en: 'Hiring: Candidates removed by the retention can be restored',
    es: 'Hiring: Los candidatos que saca la retención se pueden restaurar',
    pt: 'Hiring: Os candidatos removidos pela retenção podem ser restaurados',
  },
  items: [
    {
      product: 'hiring',
      en: 'When the workspace deletes candidates after a number of months without activity, candidates near the end of that term now go to a trash in Hiring settings instead of being deleted right away. An admin sees their name and when they will be deleted for good, and can restore them with their applications, notes and files. Candidates are still deleted for good, with their CV and documents, on the same day as before. A candidate who uses the deletion link in the email is deleted right away, also from the trash.',
      es: 'Cuando el workspace borra candidatos tras unos meses sin actividad, los que llegan al final de ese plazo ahora pasan a una papelera en los ajustes de Hiring en vez de borrarse en el momento. Un admin ve su nombre y cuándo se borran para siempre, y los puede restaurar con sus postulaciones, notas y archivos. Los candidatos se siguen borrando para siempre, con su CV y documentos, el mismo día que antes. Un candidato que usa el link de borrado del email se borra en el momento, también de la papelera.',
      pt: 'Quando o workspace exclui candidatos após alguns meses sem atividade, os que chegam ao fim desse prazo agora vão para uma lixeira nos ajustes do Hiring em vez de serem excluídos na hora. Um admin vê o nome e quando serão excluídos de vez, e pode restaurá-los com candidaturas, notas e arquivos. Os candidatos continuam sendo excluídos de vez, com currículo e documentos, no mesmo dia de antes. Um candidato que usa o link de exclusão do email é excluído na hora, também da lixeira.',
    },
  ],
} satisfies ChangelogEntry;
