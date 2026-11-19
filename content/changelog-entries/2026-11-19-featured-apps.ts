import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-featured-apps',
  date: '2026-11-19',
  title: {
    en: 'Pick the featured apps of your workspace: they go at the top of the apps menu',
    es: 'Elegí las apps destacadas de tu workspace: van arriba en el menú de apps',
    pt: 'Escolha os apps em destaque do seu workspace: eles ficam no topo do menu de apps',
  },
  items: [
    {
      product: 'platform',
      en: 'In Settings › Workspace apps each app now has a star next to its on/off switch. The owner and admins star the apps the team uses most, and that choice applies to everyone in the workspace. The apps menu (the one that opens from the workspace name at the top left) then shows the featured apps first and keeps the rest under "Other apps", a row that opens in place like "Coming soon". Search still finds every app. If you star nothing, the menu stays as it was, with every app by category. For people who did not pick their own apps when they signed up, the featured apps also come first in the sidebar of the home page and in its grid.',
      es: 'En Ajustes › Apps del workspace cada app ahora tiene una estrella al lado del interruptor para prenderla o apagarla. El owner y los admins marcan las apps que más usa el equipo, y esa elección vale para todas las personas del workspace. El menú de apps (el que se abre desde el nombre del workspace, arriba a la izquierda) muestra entonces primero las destacadas y deja el resto en "Otras apps", una fila que se abre en el lugar como "Próximamente". La búsqueda sigue encontrando todas las apps. Si no marcás ninguna, el menú queda como estaba, con todas las apps por categoría. Para quienes no eligieron sus apps al registrarse, las destacadas también van primero en la barra lateral del inicio y en su grilla.',
      pt: 'Em Ajustes › Apps do workspace cada app agora tem uma estrela ao lado do interruptor de ligar e desligar. O owner e os admins marcam os apps que a equipe mais usa, e essa escolha vale para todas as pessoas do workspace. O menu de apps (o que abre pelo nome do workspace, no canto superior esquerdo) passa a mostrar primeiro os destaques e deixa o resto em "Outros apps", uma linha que abre no lugar como "Em breve". A busca continua encontrando todos os apps. Se você não marcar nenhum, o menu fica como estava, com todos os apps por categoria. Para quem não escolheu seus apps ao se cadastrar, os destaques também vêm primeiro na barra lateral do início e na grade dele.',
    },
  ],
} satisfies ChangelogEntry;
