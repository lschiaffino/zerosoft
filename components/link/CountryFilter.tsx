'use client';

import { useRouter } from '@/i18n/navigation';

interface CountryFilterProps {
  id: string;
  linkId: string;
  range: string;
  value: string;
  countries: string[];
  allLabel: string;
}

/** Filtro de país del click log: aplica al cambiar (sin botón "Apply"). */
export default function CountryFilter({ id, linkId, range, value, countries, allLabel }: CountryFilterProps) {
  const router = useRouter();
  return (
    <select
      id={id}
      className="input mono filter-select"
      value={value}
      onChange={(e) => {
        const country = e.target.value;
        router.push(
          {
            pathname: `/app/links/${linkId}`,
            query: country ? { range, country } : { range },
          },
          { scroll: false },
        );
      }}
    >
      <option value="">{allLabel}</option>
      {countries.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
