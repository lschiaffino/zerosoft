import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-search-name-words',
  date: '2026-11-19',
  title: {
    en: 'Inbox and Lines search: a chat is found by the words of its name, in any order',
    es: 'Búsqueda de Inbox y Lines: un chat se encuentra por las palabras de su nombre, en cualquier orden',
    pt: 'Busca do Inbox e do Lines: uma conversa é encontrada pelas palavras do nome, em qualquer ordem',
  },
  items: [
    {
      product: 'inbox',
      en: 'Searching for several words only found a chat when its name had them exactly as typed. A group called "Ana, Beto, Carla" did not show up for "ana beto carla" because of the commas, nor for "beto ana". Now the name matches when it has every word you typed, in any order and whatever punctuation sits between them, as in WhatsApp. A phone number is also found when you type it with +, spaces, dashes or brackets.',
      es: 'Buscar varias palabras solo encontraba un chat cuando su nombre las tenía exactamente como las escribiste. Un grupo llamado "Ana, Beto, Carla" no aparecía con "ana beto carla" por las comas, ni con "beto ana". Ahora el nombre coincide cuando tiene todas las palabras que escribiste, en cualquier orden y con la puntuación que haya en el medio, como en WhatsApp. Un teléfono también se encuentra si lo escribís con +, espacios, guiones o paréntesis.',
      pt: 'Buscar várias palavras só encontrava uma conversa quando o nome as tinha exatamente como você digitou. Um grupo chamado "Ana, Beto, Carla" não aparecia com "ana beto carla" por causa das vírgulas, nem com "beto ana". Agora o nome coincide quando tem todas as palavras digitadas, em qualquer ordem e com qualquer pontuação no meio, como no WhatsApp. Um telefone também é encontrado se você o digitar com +, espaços, hifens ou parênteses.',
    },
  ],
} satisfies ChangelogEntry;
