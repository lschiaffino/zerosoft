'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';

interface ProjectFormProps {
  locale: string;
  labels: {
    name: string;
    namePlaceholder: string;
    slug: string;
    slugPlaceholder: string;
    description: string;
    icon: string;
    color: string;
    create: string;
    cancel: string;
    saving: string;
    genericError: string;
  };
}

export default function ProjectForm({ locale, labels }: ProjectFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('◆');
  const [color, setColor] = useState('#000000');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  function onNameChange(value: string) {
    setName(value);
    if (!slug) setSlug(slugify(value));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/track/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || slugify(name),
          description: description.trim(),
          icon: icon.trim() || null,
          color,
        }),
      });

      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { error?: string }).error ?? 'generic';
        setError(code);
        setSubmitting(false);
        return;
      }

      const project = data as { id: string };
      router.push(`/${locale}/app/track/projects/${project.id}`);
    } catch {
      setError('generic');
      setSubmitting(false);
    }
  }

  return (
    <form className="track-form" onSubmit={onSubmit}>
      {error && <p className="form-error">{labels.genericError}</p>}

      <div className="track-form-row">
        <label htmlFor="name">{labels.name}</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={labels.namePlaceholder}
          required
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="slug">{labels.slug}</label>
        <input
          id="slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(slugify(e.target.value))}
          placeholder={labels.slugPlaceholder}
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="description">{labels.description}</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="icon">{labels.icon}</label>
        <input id="icon" type="text" value={icon} onChange={(e) => setIcon(e.target.value)} />
      </div>

      <div className="track-form-row">
        <label htmlFor="color">{labels.color}</label>
        <input id="color" type="text" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>

      <div className="track-form-actions">
        <button type="submit" className="btn btn-solid" disabled={submitting || !name.trim()}>
          {submitting ? labels.saving : labels.create}
        </button>
      </div>
    </form>
  );
}
