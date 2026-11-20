import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-update-notice-newest',
  date: '2026-11-19',
  title: {
    en: 'The "new version" notice shows the latest changes',
    es: 'El aviso de "versión nueva" muestra los cambios más recientes',
    pt: 'O aviso de "versão nova" mostra as mudanças mais recentes',
  },
  items: [
    {
      product: 'platform',
      en: 'On days with many changes, the notice could list changes from the morning as what was new, because entries of the same day had no order. Entries now carry the time they were written, so the notice and the changelog show the newest first.',
      es: 'En los días con muchos cambios, el aviso podía mostrar como novedad cambios de la mañana, porque las entradas del mismo día no tenían orden. Ahora cada entrada lleva la hora en que se escribió, así el aviso y el changelog muestran primero lo más nuevo.',
      pt: 'Nos dias com muitas mudanças, o aviso podia mostrar como novidade mudanças da manhã, porque as entradas do mesmo dia não tinham ordem. Agora cada entrada traz a hora em que foi escrita, então o aviso e o changelog mostram primeiro o mais novo.',
    },
  ],
} satisfies ChangelogEntry;
