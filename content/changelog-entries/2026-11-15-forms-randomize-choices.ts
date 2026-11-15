import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-forms-randomize-choices',
  date: '2026-11-15',
  title: {
    en: 'Forms: Show options in random order',
    es: 'Forms: Mostrar las opciones en orden aleatorio',
    pt: 'Forms: Mostrar as opções em ordem aleatória',
  },
  items: [
    {
      product: 'forms',
      en: 'Multiple choice, checkboxes, dropdown and ranking questions have a new setting, Show options in random order. Each person who answers sees a different order, which avoids the first option getting more picks just for being first. The answers and the CSV keep the same option labels, and the keyboard letters follow the order on screen.',
      es: 'Las preguntas de opción múltiple, casillas, desplegable y ranking tienen un ajuste nuevo, Mostrar las opciones en orden aleatorio. Cada persona que responde ve un orden distinto, así la primera opción no gana votos solo por estar primera. Las respuestas y el CSV conservan las mismas etiquetas y las letras del teclado siguen el orden de la pantalla.',
      pt: 'As perguntas de múltipla escolha, caixas de seleção, lista suspensa e ranking têm um ajuste novo, Mostrar as opções em ordem aleatória. Cada pessoa que responde vê uma ordem diferente, assim a primeira opção não ganha votos só por ser a primeira. As respostas e o CSV mantêm os mesmos rótulos e as letras do teclado seguem a ordem da tela.',
    },
  ],
} satisfies ChangelogEntry;
