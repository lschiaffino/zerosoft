import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0707-crm-column-filters',
  date: '2026-11-23',
  title: {
    en: 'CRM: filter contacts, companies and deals from the column header',
    es: 'CRM: filtrá contactos, empresas y deals desde el encabezado de la columna',
    pt: 'CRM: filtre contatos, empresas e negócios pelo cabeçalho da coluna',
  },
  items: [
    {
      product: 'crm',
      en: 'The menu of each column header now has Filter by this column, with the right control for the property: text that contains or is a value, options to tick, owner, a number or date range, yes or no, and has a value or is empty. The rule joins the rest of the filters, shows as a chip above the table, marks the column header, and is saved with the view. Select all and Export view use the same rule. Properties hidden to you cannot be filtered.',
      es: 'El menú de cada encabezado de columna ahora tiene Filtrar por esta columna, con el control que corresponde a la propiedad: texto que contiene o es un valor, opciones para marcar, owner, un rango de números o de fechas, sí o no, y con valor o vacío. La regla se suma al resto de los filtros, se ve como un chip arriba de la tabla, marca el encabezado de la columna y se guarda con la vista. Elegir todos y Exportar vista usan la misma regla. Las propiedades que tenés ocultas no se pueden filtrar.',
      pt: 'O menu de cada cabeçalho de coluna agora tem Filtrar por esta coluna, com o controle certo para a propriedade: texto que contém ou é um valor, opções para marcar, owner, um intervalo de números ou de datas, sim ou não, e com valor ou vazio. A regra se soma aos outros filtros, aparece como um chip acima da tabela, marca o cabeçalho da coluna e é salva com a visualização. Selecionar todos e Exportar visualização usam a mesma regra. As propriedades ocultas para você não podem ser filtradas.',
    },
  ],
} satisfies ChangelogEntry;
