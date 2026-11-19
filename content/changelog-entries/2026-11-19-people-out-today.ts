import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-people-out-today',
  date: '2026-11-19',
  title: {
    en: 'People: see who is out today in the directory',
    es: 'People: mirá quién está fuera hoy en el directorio',
    pt: 'People: veja quem está fora hoje no diretório',
  },
  items: [
    {
      product: 'people',
      en: 'Someone with approved time off today shows "Out until" and their return date, or the half day, next to their name in the directory and on their profile. Back-to-back requests count as one stretch. The "Out today" filter lists only the people who are away. Everyone sees who is out; the type of leave stays visible only to HR, the person and their managers.',
      es: 'Quien tiene una licencia aprobada hoy muestra "Fuera hasta" con la fecha de vuelta, o la media jornada, al lado de su nombre en el directorio y en su ficha. Dos pedidos seguidos cuentan como uno solo. El filtro "Fuera hoy" muestra solo a la gente que no está. Todos ven quién está fuera; el tipo de licencia lo siguen viendo solo HR, la persona y sus managers.',
      pt: 'Quem tem uma folga aprovada hoje mostra "Fora até" com a data de volta, ou o meio período, ao lado do nome no diretório e no perfil. Dois pedidos seguidos contam como um só. O filtro "Fora hoje" mostra só as pessoas que estão fora. Todos veem quem está fora; o tipo de folga continua visível só para o RH, a pessoa e os gestores dela.',
    },
  ],
} satisfies ChangelogEntry;
