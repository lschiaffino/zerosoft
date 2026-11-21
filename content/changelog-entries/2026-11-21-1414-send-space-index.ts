import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-send-space-index',
  date: '2026-11-21',
  title: {
    en: 'Send: numbered index for spaces',
    es: 'Send: índice numerado en los espacios',
    pt: 'Send: índice numerado nos espaços',
  },
  items: [
    {
      product: 'send',
      en: 'Turn on "Number folders and documents" in a space and every folder and document gets a number (1, 2, 2.1) in the space and in the viewer, so in a due diligence people can say "see 2.1". The numbers are the same for every visitor, even when the access list shows them only some documents. The owner and visitors can download the index as a CSV; a visitor\'s index lists only what they can open.',
      es: 'Prendé "Numerar carpetas y documentos" en un espacio y cada carpeta y documento lleva un número (1, 2, 2.1) en el espacio y en el visor, así en una due diligence se puede decir "mirá el 2.1". Los números son los mismos para cada visitante, aunque la lista de acceso le muestre solo algunos documentos. El dueño y quien visita pueden bajar el índice en CSV; el de quien visita lista solo lo que puede abrir.',
      pt: 'Ative "Numerar pastas e documentos" em um espaço e cada pasta e documento ganha um número (1, 2, 2.1) no espaço e no visor, então numa due diligence dá para dizer "veja o 2.1". Os números são os mesmos para cada visitante, mesmo quando a lista de acesso mostra só alguns documentos. O dono e quem visita podem baixar o índice em CSV; o de quem visita lista só o que pode abrir.',
    },
  ],
} satisfies ChangelogEntry;
