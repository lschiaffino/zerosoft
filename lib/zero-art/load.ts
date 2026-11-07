import type { Figure } from './engine';
import type { FigureRef } from './catalog';

/** Trae solo la familia que hace falta: cada una es un pedazo de JS aparte. */
export async function loadFigure([family, variant]: FigureRef): Promise<Figure> {
  switch (family) {
    case 'board':
      return (await import('./figures/board')).boardFigure(variant);
    case 'chain':
      return (await import('./figures/chain')).chainFigure();
    case 'chart':
      return (await import('./figures/chart')).chartFigure(variant);
    case 'days':
      return (await import('./figures/days')).daysFigure(variant);
    case 'field':
      return (await import('./figures/field')).fieldFigure();
    case 'graph':
      return (await import('./figures/graph')).graphFigure(variant);
    case 'notfound':
      return (await import('./figures/notfound')).notFoundFigure();
    case 'paper':
      return (await import('./figures/paper')).paperFigure(variant);
    case 'shapes':
      return (await import('./figures/shapes')).shapesFigure(variant);
    case 'sketch':
      return (await import('./figures/sketch')).sketchFigure(variant);
  }
}
