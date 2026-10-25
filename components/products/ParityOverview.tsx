import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PARITY } from "@/content/feature-parity";
import { computeParity } from "@/lib/feature-parity";
import { PRODUCT_CONFIG, PRODUCT_KEYS } from "@/lib/products";
import { SECTION_IDS } from "@/components/site/catalog";
import SectionSign from "@/components/site/SectionSign";

/**
 * Tabla de paridad de todas las apps contra su competidor, calculada en vivo
 * de content/feature-parity (la misma fórmula que cada página de producto).
 */
export default async function ParityOverview({
  locale,
  headingId,
  id = "paridad",
}: {
  locale: string;
  headingId: string;
  id?: string;
}) {
  const t = await getTranslations({
    locale,
    namespace: "pages.parityOverview",
  });
  const rows = PRODUCT_KEYS.map((k) => ({
    key: k,
    competitor: PARITY[k].competitor,
    score: computeParity(PARITY[k].rows),
  }));
  const counted = rows.reduce((s, r) => s + r.score.counted, 0);
  // Promedio simple de los porcentajes por app, truncado como computeParity.
  const average = Math.floor(
    rows.reduce((s, r) => s + r.score.percent, 0) / rows.length,
  );

  return (
    <section className="lp-section" id={id} aria-labelledby={headingId}>
      <SectionSign id={headingId} title={t("title")} sub={t("titleDim")} />
      <div className="container parity-overview">
        <p className="parity-overview-lead">
          {t("lead", { average, counted })}
        </p>
        <div className="parity-overview-wrap">
          <table className="parity-overview-table" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th scope="col">{t("col.app")}</th>
                <th scope="col" className="po-sm-hide">
                  {t("col.competitor")}
                </th>
                <th scope="col" className="po-bar-col">
                  {t("col.parity")}
                </th>
                <th scope="col" className="po-num">
                  {t("col.have")}
                </th>
                <th scope="col" className="po-num po-sm-hide">
                  {t("col.partial")}
                </th>
                <th scope="col" className="po-num po-sm-hide">
                  {t("col.missing")}
                </th>
                <th scope="col" className="po-num po-sm-hide">
                  {t("col.beyond")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, competitor, score }) => (
                <tr key={key}>
                  <th scope="row">
                    <Link
                      href={`/products/${key}#${SECTION_IDS.parity}`}
                      className="po-app"
                    >
                      <i
                        className="po-dot"
                        style={{ background: `var(--c-${key})` }}
                        aria-hidden="true"
                      />
                      {PRODUCT_CONFIG[key].name}
                    </Link>
                  </th>
                  <td className="po-competitor po-sm-hide">{competitor}</td>
                  <td className="po-bar-col">
                    <span className="po-bar-cell">
                      <span className="parity-bar" aria-hidden="true">
                        <i style={{ width: `${score.percent}%` }} />
                      </span>
                      <span className="data po-percent">{`${score.percent}%`}</span>
                    </span>
                  </td>
                  <td className="po-num data">{score.have}</td>
                  <td className="po-num po-sm-hide data">{score.partial}</td>
                  <td className="po-num po-sm-hide data">{score.missing}</td>
                  <td className="po-num po-sm-hide data">{score.beyond}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="parity-method">{t("method")}</p>
      </div>
    </section>
  );
}
