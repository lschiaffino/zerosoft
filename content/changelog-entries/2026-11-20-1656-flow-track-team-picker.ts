import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1656-flow-track-team-picker',
  date: '2026-11-20',
  title: {
    en: 'Flow: pick the Track team from a list in the Create issue step',
    es: 'Flow: el paso Crear issue de Track elige el equipo de una lista',
    pt: 'Flow: o passo Criar issue do Track escolhe a equipe de uma lista',
  },
  items: [
    {
      product: 'flow',
      en: 'The Track: create issue step used to ask for a project ID that you had to copy from somewhere else. Now it lists the Track teams you can see, with a link to open the one you picked. If the team was deleted, the field says so. A run that fails because the team is gone explains what happened instead of showing an error code.',
      es: 'El paso Track: crear issue pedía un ID de proyecto que había que copiar de otro lado. Ahora lista los equipos de Track que ves, con un link para abrir el elegido. Si el equipo se borró, el campo lo dice. Una corrida que falla porque el equipo ya no existe explica qué pasó en lugar de mostrar un código de error.',
      pt: 'O passo Track: criar issue pedia um ID de projeto que era preciso copiar de outro lugar. Agora ele lista as equipes do Track que você vê, com um link para abrir a escolhida. Se a equipe foi apagada, o campo avisa. Uma execução que falha porque a equipe não existe mais explica o que aconteceu em vez de mostrar um código de erro.',
    },
  ],
} satisfies ChangelogEntry;
