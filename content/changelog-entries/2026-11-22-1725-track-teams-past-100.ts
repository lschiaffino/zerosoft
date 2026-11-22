import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-track-teams-past-100',
  date: '2026-11-22',
  title: {
    en: 'Track: every team in the sidebar, past the first 100',
    es: 'Track: todos los equipos en el sidebar, también después de los primeros 100',
    pt: 'Track: todas as equipes na barra lateral, também depois das primeiras 100',
  },
  items: [
    {
      product: 'track',
      en: 'With more than 100 teams, the ones that came last in alphabetical order were missing from the sidebar, from Move to team and from the team picker when creating an issue, in Track and from Board, Notes, Voice and Chat. They all show now. The sidebar list also no longer jumps when you scroll to the end, so dropping an issue on the last teams lands on the team under the pointer. On a phone, the empty "Your teams" heading is gone from the menu.',
      es: 'Con más de 100 equipos, los últimos en orden alfabético no aparecían en el sidebar, en Mover a otro equipo ni en el selector de equipo al crear un issue, en Track y desde Board, Notes, Voice y Chat. Ahora aparecen todos. Además, la lista del sidebar ya no salta al llegar al final, así que soltar un issue sobre los últimos equipos cae en el equipo que está bajo el puntero. En el celular, el menú ya no muestra el título "Tus equipos" vacío.',
      pt: 'Com mais de 100 equipes, as últimas em ordem alfabética não apareciam na barra lateral, em Mover para outra equipe nem no seletor de equipe ao criar uma issue, no Track e a partir do Board, Notes, Voice e Chat. Agora aparecem todas. Além disso, a lista da barra lateral não pula mais ao chegar ao fim, então soltar uma issue sobre as últimas equipes cai na equipe que está sob o ponteiro. No celular, o menu não mostra mais o título "Suas equipes" vazio.',
    },
  ],
} satisfies ChangelogEntry;
