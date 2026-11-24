import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-list-title-phone',
  date: '2026-11-23',
  title: {
    en: 'Lines: the list title reads in full on a phone',
    es: 'Lines: el título de la lista se lee entero en el teléfono',
    pt: 'Lines: o título da lista aparece inteiro no celular',
  },
  items: [
    {
      product: 'groups',
      en: 'On a phone, the title above the chat list (Inbox, or the name of a list) was cut next to the line selector, for example "Caixa de ent..." in Portuguese. The title now keeps its width and the line selector is what gets shortened, as WhatsApp keeps its title in view.',
      es: 'En el teléfono, el título arriba de la lista de chats (Bandeja, o el nombre de una lista) se cortaba al lado del selector de línea, por ejemplo "Caixa de ent..." en portugués. Ahora el título conserva su ancho y lo que se acorta es el selector de línea, como WhatsApp, que deja su título a la vista.',
      pt: 'No celular, o título acima da lista de conversas (Caixa de entrada, ou o nome de uma lista) ficava cortado ao lado do seletor de linha, por exemplo "Caixa de ent...". Agora o título mantém a largura e quem encurta é o seletor de linha, como no WhatsApp, que deixa o título à vista.',
    },
  ],
} satisfies ChangelogEntry;
