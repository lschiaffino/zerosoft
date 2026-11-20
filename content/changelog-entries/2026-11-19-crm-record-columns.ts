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
      en: 'The page of a contact, a company and a deal now has three columns, like the record page in HubSpot. On the left: the name, quick buttons for a note, an email, a call, a task and a meeting, and the properties, which you edit in place while you read the timeline. In the middle: the Overview and Activities tabs. On the right: one card per association (companies, contacts, deals, files, lists and the rest). The cards of linked records show how many there are.',
      es: 'La ficha de un contacto, una empresa y un deal ahora tiene tres columnas, como la ficha de HubSpot. A la izquierda: el nombre, botones rápidos para una nota, un email, una llamada, una tarea y una reunión, y las propiedades, que editás en el lugar mientras leés el timeline. En el medio: las pestañas Resumen y Actividades. A la derecha: una tarjeta por asociación (empresas, contactos, deals, archivos, listas y el resto). Las tarjetas de registros vinculados muestran cuántos hay.',
      pt: 'A página de um contato, uma empresa e um negócio agora tem três colunas, como a página de registro do HubSpot. À esquerda: o nome, botões rápidos para uma nota, um email, uma ligação, uma tarefa e uma reunião, e as propriedades, que você edita no lugar enquanto lê o timeline. No meio: as abas Visão geral e Atividades. À direita: um cartão por associação (empresas, contatos, negócios, arquivos, listas e o resto). Os cartões de registros vinculados mostram quantos há.',
    },
    {
      product: 'crm',
      en: 'The record opens on Overview: the next task, highlights, the latest emails, calls and meetings, and a short list of each association; on a deal, also its line items and quotes. Activities is one click away and switching between the two does not reload the page. The quick buttons open the timeline composer on that kind of activity from any tab.',
      es: 'La ficha abre en el Resumen: la próxima tarea, datos destacados, los últimos emails, llamadas y reuniones, y una lista corta de cada asociación; en un deal, también sus productos y cotizaciones. Actividades queda a un clic y pasar de una a otra no recarga la página. Los botones rápidos abren el composer del timeline en ese tipo de actividad desde cualquier pestaña.',
      pt: 'A página abre na Visão geral: a próxima tarefa, destaques, os últimos emails, ligações e reuniões, e uma lista curta de cada associação; em um negócio, também seus itens e cotações. Atividades fica a um clique e passar de uma para a outra não recarrega a página. Os botões rápidos abrem o composer do timeline nesse tipo de atividade a partir de qualquer aba.',
    },
    {
      product: 'crm',
      en: 'Every card collapses with the arrow next to its title, and your browser remembers which ones you left collapsed. A collapsed card that can take more records shows an Add button that opens it. On a phone the page is one column: the name and the quick buttons first, then four tabs (Overview, Activities, About and Associations). Links you saved to the old Properties and Related tabs still open the same record.',
      es: 'Cada tarjeta se pliega con la flecha al lado de su título, y tu navegador recuerda cuáles dejaste plegadas. Una tarjeta plegada a la que se le pueden sumar registros muestra un botón Agregar que la abre. En el teléfono la ficha es una columna: primero el nombre y los botones rápidos, después cuatro pestañas (Resumen, Actividades, Datos y Asociaciones). Los links que guardaste a las pestañas Propiedades y Relacionados de antes siguen abriendo el mismo registro.',
      pt: 'Cada cartão se recolhe com a seta ao lado do título, e seu navegador lembra quais você deixou recolhidos. Um cartão recolhido que pode receber mais registros mostra um botão Adicionar que o abre. No celular a página é uma coluna: primeiro o nome e os botões rápidos, depois quatro abas (Visão geral, Atividades, Sobre e Associações). Os links que você salvou para as abas Propriedades e Relacionados de antes continuam abrindo o mesmo registro.',
    },
    {
      product: 'crm',
      en: 'For members who only see their own records or their team: the deal value of a company and its count of child companies now include only what that person can see, and the parent company, the name of a converted lead deal and a saved AI summary are shown only when they can see what is behind them.',
      es: 'Para los miembros que solo ven sus registros o los de su equipo: el valor en deals de una empresa y su cantidad de empresas hijas ahora incluyen solo lo que esa persona puede ver, y la empresa madre, el nombre del deal de un lead convertido y un resumen de IA guardado se muestran solo cuando puede ver lo que hay detrás.',
      pt: 'Para os membros que só veem seus registros ou os da equipe: o valor em negócios de uma empresa e sua quantidade de empresas filhas agora incluem só o que essa pessoa pode ver, e a empresa mãe, o nome do negócio de um lead convertido e um resumo de IA salvo aparecem só quando ela pode ver o que há por trás.',
    },
  ],
} satisfies ChangelogEntry;
