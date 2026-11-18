import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-forms-save-keeps-typing',
  date: '2026-11-17',
  title: {
    en: 'Forms: what you type while saving stays',
    es: 'Forms: lo que escribís mientras se guarda queda',
    pt: 'Forms: o que você digita enquanto salva fica',
  },
  items: [
    {
      product: 'forms',
      en: 'Typing in the builder while a save was in progress erased the new text when the save finished. Now only what you did not touch takes the saved version, and "Unsaved changes" stays until you save again.',
      es: 'Escribir en el editor mientras se guardaba borraba el texto nuevo al terminar el guardado. Ahora solo lo que no tocaste toma la versión guardada, y "Cambios sin guardar" sigue hasta que guardes de nuevo.',
      pt: 'Digitar no editor enquanto salvava apagava o texto novo quando o salvamento terminava. Agora só o que você não mexeu recebe a versão salva, e "Alterações não salvas" continua até você salvar de novo.',
    },
  ],
} satisfies ChangelogEntry;
