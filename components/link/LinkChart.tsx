import { useLocale, useTranslations } from 'next-intl';
import type { DayCount } from '@/lib/track';
import { chartDateLabel, spansYears } from '@/lib/chart-dates';
import LinkChartView from './LinkChartView';

interface LinkChartProps {
  data: DayCount[];
  /** Segunda serie (misma longitud que data), dibujada como línea punteada. */
  secondary?: DayCount[];
}

/**
 * Gráfico de clicks por día. Acá se arman los textos (fechas en el formato del
 * locale y el resumen para lectores de pantalla); el dibujo es de LinkChartView,
 * que mide su ancho real para que las etiquetas no se achiquen en mobile.
 */
export default function LinkChart({ data, secondary }: LinkChartProps) {
  const t = useTranslations('link');
  const locale = useLocale();

  const withYear = spansYears(data.map((d) => d.date));
  const total = data.reduce((a, d) => a + d.count, 0);
  const peak = data.reduce<DayCount | null>((best, d) => (!best || d.count > best.count ? d : best), null);
  const summary =
    peak && total > 0
      ? `${t('detail.chartAria')}. ${t('detail.chartSummary', { total, peak: peak.count, date: chartDateLabel(peak.date, locale, true) })}`
      : t('detail.chartAria');

  return (
    <LinkChartView
      counts={data.map((d) => d.count)}
      secondary={secondary?.map((d) => d.count)}
      labels={data.map((d) => chartDateLabel(d.date, locale, withYear))}
      summary={summary}
    />
  );
}
