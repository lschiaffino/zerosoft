import type { Figure } from '../engine';
import type { FigureRef } from '../catalog';
import { boardFigure } from './board';
import { chainFigure } from './chain';
import { chartFigure } from './chart';
import { daysFigure } from './days';
import { fieldFigure } from './field';
import { graphFigure } from './graph';
import { notFoundFigure } from './notfound';
import { paperFigure } from './paper';
import { shapesFigure } from './shapes';
import { sketchFigure } from './sketch';

/** Todas juntas, para el servidor y los tests. En el navegador se cargan de a una (../load). */
export function makeFigure([family, variant]: FigureRef): Figure {
  switch (family) {
    case 'board':
      return boardFigure(variant);
    case 'chain':
      return chainFigure();
    case 'chart':
      return chartFigure(variant);
    case 'days':
      return daysFigure(variant);
    case 'field':
      return fieldFigure();
    case 'graph':
      return graphFigure(variant);
    case 'notfound':
      return notFoundFigure();
    case 'paper':
      return paperFigure(variant);
    case 'shapes':
      return shapesFigure(variant);
    case 'sketch':
      return sketchFigure(variant);
  }
}
