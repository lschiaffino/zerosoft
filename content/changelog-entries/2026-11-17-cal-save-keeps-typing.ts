import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-cal-save-keeps-typing',
  date: '2026-11-17',
  title: {
    en: 'Cal: what you type while saving stays',
    es: 'Cal: lo que escribís mientras se guarda queda',
    pt: 'Cal: o que você digita enquanto salva fica',
  },
  items: [
    {
      product: 'cal',
      en: 'In the event type editor, changes made while a save was in progress were erased when it finished. Now they stay, and Save stays on so you can send them.',
      es: 'En el editor del tipo de evento, los cambios hechos mientras se guardaba se borraban al terminar. Ahora quedan, y Guardar sigue disponible para mandarlos.',
      pt: 'No editor do tipo de evento, as mudanças feitas enquanto salvava eram apagadas ao terminar. Agora ficam, e Salvar continua disponível para enviá-las.',
    },
    {
      product: 'cal',
      en: 'Scheduling on behalf of someone no longer resets the host and location you picked when the page refreshes.',
      es: 'Agendar en nombre de otra persona ya no vuelve atrás el anfitrión y la ubicación elegidos cuando la página se refresca.',
      pt: 'Agendar em nome de outra pessoa não volta mais o anfitrião e o local escolhidos quando a página é atualizada.',
    },
  ],
} satisfies ChangelogEntry;
