import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { appBase } from '@/lib/hiring/core';
import { jobPostingJsonLd, jobUrl, publishedCareers, publishedJob, publishedJobs, type PublicJob } from '@/lib/hiring/careers';
import { careersStrings, fill, type CareersStrings } from '@/lib/hiring/careers-i18n';
import { descriptionHtml, descriptionText } from '@/lib/hiring/markdown';
import { publicOffer } from '@/lib/hiring/offers';
import ApplyForm from '@/components/hiring/careers/ApplyForm';
import OfferResponse from '@/components/hiring/careers/OfferResponse';
import ForgetForm from '@/components/hiring/careers/ForgetForm';

/**
 * Página de empleos en una sola ruta (presupuesto de rutas): la lista de
 * puestos, el aviso con su formulario, la respuesta a una oferta
 * (/offer/<token>) y el pedido de borrado de datos (/privacy/<token>).
 */
export const dynamic = 'force-dynamic';

type Params = { handle: string; path?: string[] };

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, path = [] } = await props.params;
  const c = await publishedCareers(handle);
  if (!c) return { robots: { index: false } };
  const t = careersStrings(c.locale);
  const [first] = path;
  if (first === 'offer' || first === 'privacy') return { title: `${first === 'offer' ? t.offerTitle : t.privacyTitle} · ${c.company}`, robots: { index: false } };
  if (first) {
    const job = await publishedJob(c.settings.workspace_id, first);
    if (!job) return { title: c.company };
    const canonical = jobUrl(c.settings.handle, job.slug);
    const description = descriptionText(job.description, 160);
    return { title: `${job.title} · ${c.company}`, description, alternates: { canonical }, openGraph: { title: job.title, description, url: canonical, siteName: c.company } };
  }
  const canonical = `${appBase()}/careers/${c.settings.handle}`;
  return { title: `${t.openRoles} · ${c.company}`, description: c.settings.intro.slice(0, 160) || undefined, alternates: { canonical }, openGraph: { title: c.company, url: canonical, siteName: c.company } };
}

function jobMeta(job: PublicJob, t: CareersStrings): string {
  return [job.department, job.location, t.workplace[job.workplace], t.employment[job.employmentType]].filter(Boolean).join(' · ');
}

function salaryText(job: PublicJob, t: CareersStrings, locale: string): string | null {
  if (!job.salaryPublic || (job.salaryMin == null && job.salaryMax == null)) return null;
  const f = (n: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: job.salaryCurrency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${job.salaryCurrency} ${n}`;
    }
  };
  const range = job.salaryMin != null && job.salaryMax != null ? `${f(job.salaryMin)} - ${f(job.salaryMax)}` : f((job.salaryMin ?? job.salaryMax)!);
  return `${range} ${t.period[job.salaryPeriod] ?? ''}`.trim();
}

export default async function CareersPage(props: { params: Promise<Params>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { handle, path = [] } = await props.params;
  const sp = await props.searchParams;
  const c = await publishedCareers(handle);
  if (!c) notFound();
  const t = careersStrings(c.locale);
  const [first, second] = path;
  if (path.length > 2) notFound();

  if (first === 'offer') {
    if (!second) notFound();
    const offer = await publicOffer(c.settings.handle, second);
    if (!offer) notFound();
    return <OfferResponse token={second} offer={offer} t={t} />;
  }
  if (first === 'privacy') {
    if (!second) notFound();
    return <ForgetForm token={second} company={c.company} t={t} />;
  }

  if (!first) {
    const jobs = await publishedJobs(c.settings.workspace_id);
    const groups = new Map<string, PublicJob[]>();
    for (const j of jobs) groups.set(j.department, [...(groups.get(j.department) ?? []), j]);
    return (
      <div className="cr-wrap">
        <h1 className="cr-title">{c.company}</h1>
        {c.settings.intro && <p className="cr-intro">{c.settings.intro}</p>}
        <h2 className="cr-h2">{t.openRoles}</h2>
        {jobs.length === 0 ? (
          <p className="cr-muted">{t.noRoles}</p>
        ) : (
          [...groups.entries()].map(([dept, list]) => (
            <section key={dept || '-'} className="cr-dept">
              {dept && <h3 className="cr-dept-title">{dept}</h3>}
              <ul className="cr-jobs">
                {list.map((j) => (
                  <li key={j.id}>
                    <a className="cr-job" href={`/careers/${c.settings.handle}/${j.slug}${sp.utm_source ? `?utm_source=${encodeURIComponent(sp.utm_source)}` : ''}`}>
                      <span className="cr-job-title">{j.title}</span>
                      <span className="cr-job-meta">{jobMeta(j, t)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    );
  }

  if (second) notFound();
  const job = await publishedJob(c.settings.workspace_id, first);
  if (!job) notFound();
  const html = descriptionHtml(job.description);
  const ld = jobPostingJsonLd(c, job, html);
  const salary = salaryText(job, t, c.locale);
  const utm = Object.fromEntries(Object.entries(sp).filter(([k, v]) => /^utm_(source|medium|campaign|term|content)$/.test(k) && typeof v === 'string')) as Record<string, string>;
  return (
    <div className="cr-wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <p className="cr-back">
        <a href={`/careers/${c.settings.handle}`}>{t.allJobs}</a>
      </p>
      <h1 className="cr-title">{job.title}</h1>
      <p className="cr-job-meta">{jobMeta(job, t)}</p>
      {salary && (
        <p className="cr-salary">
          {t.salary}: {salary}
        </p>
      )}
      <article className="cr-prose" dangerouslySetInnerHTML={{ __html: html }} />
      <section className="cr-apply" aria-labelledby="cr-apply-title">
        <h2 id="cr-apply-title" className="cr-h2">
          {t.applyFor}
        </h2>
        <ApplyForm
          handle={c.settings.handle}
          job={job.slug}
          questions={job.questions}
          consentText={c.settings.consent_text || fill(t.consentDefault, { company: c.company })}
          utm={utm}
          source={sp.source ?? null}
          t={t}
        />
      </section>
    </div>
  );
}
