import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-voice-refresh-keeps-edits',
  date: '2026-11-17',
  title: {
    en: 'Voice: refreshing a meeting keeps your edits and checkboxes',
    es: 'Voice: el refresco de la reunión respeta tus ediciones y tildes',
    pt: 'Voice: a atualização da reunião respeita suas edições e marcações',
  },
  items: [
    {
      product: 'voice',
      en: 'While a meeting page refreshed itself, the next steps you had unchecked came back checked, and text typed right after an autosave could jump back. Now a refresh only replaces the note when it is a new one and nothing you wrote is waiting to be saved.',
      es: 'Mientras la página de la reunión se refrescaba sola, los próximos pasos que habías destildado volvían a tildarse, y el texto escrito justo después de un guardado automático podía volver atrás. Ahora un refresco solo reemplaza la nota cuando es una nota nueva y no hay nada tuyo esperando a guardarse.',
      pt: 'Enquanto a página da reunião se atualizava sozinha, os próximos passos que você tinha desmarcado voltavam marcados, e o texto digitado logo depois de um salvamento automático podia voltar atrás. Agora uma atualização só substitui a nota quando ela é nova e não há nada seu esperando para ser salvo.',
    },
  ],
} satisfies ChangelogEntry;
