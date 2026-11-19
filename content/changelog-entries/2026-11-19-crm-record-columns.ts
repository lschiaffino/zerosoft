import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-crm-record-columns',
  date: '2026-11-19',
  title: {
    en: 'CRM records in three columns',
    es: 'Las fichas del CRM, en tres columnas',
    pt: 'As páginas de registro do CRM, em três colunas',
  },
  items: [
    {
      product: 'crm',
      en: 'The page of a contact, a company and a deal now has three columns, like the record page in HubSpot. On the left: the name, quick buttons for a note, an email, a call, a task and a meeting, and the properties, which you edit in place while you read the timeline. In the middle: the Overview and Activities tabs. On the right: one card per association (companies, contacts, deals, files, lists and the rest), each with its count and an Add button.',
      es: 'La ficha de un contacto, una empresa y un deal ahora tiene tres columnas, como la ficha de HubSpot. A la izquierda: el nombre, botones rápidos para una nota, un email, una llamada, una tarea y una reunión, y las propiedades, que editás en el lugar mientras leés el timeline. En el medio: las pestañas Resumen y Actividades. A la derecha: una tarjeta por asociación (empresas, contactos, deals, archivos, listas y el resto), cada una con su cantidad y un botón Agregar.',
      pt: 'A página de um contato, uma empresa e um negócio agora tem três colunas, como a página de registro do HubSpot. À esquerda: o nome, botões rápidos para uma nota, um email, uma ligação, uma tarefa e uma reunião, e as propriedades, que você edita no lugar enquanto lê o timeline. No meio: as abas Visão geral e Atividades. À direita: um cartão por associação (empresas, contatos, negócios, arquivos, listas e o resto), cada um com sua quantidade e um botão Adicionar.',
    },
    {
      product: 'crm',
      en: 'Every card collapses with the arrow next to its title, and your browser remembers which ones you left collapsed. On a phone the page is one column: the name and the quick buttons first, then four tabs (Overview, Activities, About and Associations). Links you saved to the old Properties and Related tabs still open the same record. Line items and quotes of a deal moved to its Overview tab.',
      es: 'Cada tarjeta se pliega con la flecha al lado de su título, y tu navegador recuerda cuáles dejaste plegadas. En el teléfono la ficha es una columna: primero el nombre y los botones rápidos, después cuatro pestañas (Resumen, Actividades, Datos y Asociaciones). Los links que guardaste a las pestañas Propiedades y Relacionados de antes siguen abriendo el mismo registro. Los productos y las cotizaciones de un deal pasaron a su pestaña Resumen.',
      pt: 'Cada cartão se recolhe com a seta ao lado do título, e seu navegador lembra quais você deixou recolhidos. No celular a página é uma coluna: primeiro o nome e os botões rápidos, depois quatro abas (Visão geral, Atividades, Sobre e Associações). Os links que você salvou para as abas Propriedades e Relacionados de antes continuam abrindo o mesmo registro. Os itens e as cotações de um negócio passaram para a aba Visão geral.',
    },
  ],
} satisfies ChangelogEntry;
