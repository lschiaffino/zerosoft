/**
 * Renderiza cada plantilla de las tarjetas para compartir (lib/og) a PNG,
 * ancha y cuadrada, para mirarlas sin levantar el servidor.
 *
 * Uso: npx tsx scripts/og-preview.tsx <carpeta>
 * Imprime el tiempo de cada render.
 */
import * as React from 'react';
import fs from 'fs/promises';
import path from 'path';
import { renderOg, type OgSpec } from '@/lib/og/render';

// tsx compila JSX con React.createElement (el tsconfig de Next deja el JSX tal cual).
(globalThis as { React?: typeof React }).React = React;

const out = process.argv[2] ?? '.og-preview';

// Un cuadro de video de muestra (gris con un degradé), en PNG.
async function samplePoster(): Promise<string> {
  const { ImageResponse } = await import('next/og');
  const res = new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', background: 'linear-gradient(135deg, #3b4b5a 0%, #1d2a33 60%, #4a3b2f 100%)' }}>
      <div style={{ position: 'absolute', left: 120, top: 90, width: 700, height: 420, background: '#f5f5f5', display: 'flex', borderRadius: 6 }} />
      <div style={{ position: 'absolute', left: 860, top: 380, width: 220, height: 220, background: '#c9a27e', display: 'flex', borderRadius: 110 }} />
    </div>,
    { width: 1280, height: 720 },
  );
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const poster = await samplePoster();
  const small: { name: string; format: string; buf: Buffer }[] = [];
  const cards: Record<string, OgSpec> = {
    home: { seed: 'home', title: 'Twenty-six open-source apps for your team.', url: 'zerosoft.ai', apps: true },
    'home-es': { seed: 'home', title: 'Veintiséis apps open source para tu equipo.', url: 'zerosoft.ai/es', apps: true },
    crm: { seed: 'product:crm', product: 'crm', title: 'The open-source alternative to HubSpot', sub: 'Contacts, deals, sequences and quotes. Self-host for $0.', url: 'zerosoft.ai/products/crm' },
    notes: { seed: 'product:notes', product: 'notes', title: 'Notes', sub: 'The open-source alternative to Apple Notes', url: 'zerosoft.ai/products/notes' },
    compare: { seed: 'compare:track', product: 'track', title: 'Track vs Linear', sub: 'Feature parity 82%. What Track does, what it still lacks.', url: 'zerosoft.ai/compare/track-vs-linear' },
    blog: { seed: 'blog:x', label: 'Blog', product: 'flow', title: 'How we replaced Zapier with a 300-line workflow engine and stopped paying per task', sub: '8 min read', url: 'zerosoft.ai/blog/replace-zapier' },
    docs: { seed: 'page:docs', label: 'Docs', theme: 'paper', title: 'Self-host zerosoft on your own server', sub: 'Docker, environment variables, backups and upgrades.', url: 'zerosoft.ai/docs' },
    security: { seed: 'page:security', label: 'Security', theme: 'paper', title: 'Security', sub: 'How we protect your data, and how to report a vulnerability.', url: 'zerosoft.ai/security' },
    job: { seed: 'job:x', product: 'hiring', owner: 'Acme Robotics', label: 'Careers', title: 'Senior Backend Engineer', sub: 'Buenos Aires · Hybrid · Full-time', url: 'acme.zerosoft.ai/careers/senior-backend', theme: 'paper' },
    form: { seed: 'form:x', product: 'forms', owner: 'Estudio Pérez', title: 'Contanos de tu proyecto', sub: 'Te respondemos en 24 horas', url: 'zerosoft.ai/f/estudio/proyecto', theme: 'paper' },
    rec: { seed: 'rec:x', product: 'rec', owner: 'Lautaro Schiaffino', title: 'Walkthrough of the new pipeline view in the CRM', url: 'zerosoft.ai/v/abc', poster: { src: poster, duration: '4:12' } },
    long: { seed: 'x', product: 'docs', title: 'A really long page title that keeps going and going to see how the clamp behaves when there is way too much text for the card', sub: 'And an equally long sub line that also needs to be clamped after two lines of text in the card', url: 'zerosoft.ai/blog/a-really-long-slug-that-keeps-going-and-going-forever' },
  };
  for (const [name, spec] of Object.entries(cards)) {
    for (const format of ['wide', 'square'] as const) {
      // OG_BENCH=n: n renders y la mediana (el primero calienta fuentes y wasm).
      const times: number[] = [];
      let buf = Buffer.alloc(0);
      for (let n = 0; n < Math.max(1, Number(process.env.OG_BENCH) || 1); n++) {
        const t0 = performance.now();
        const res = await renderOg(spec, { format });
        buf = Buffer.from(await res.arrayBuffer());
        times.push(performance.now() - t0);
      }
      const ms = Math.round(times.sort((x, y) => x - y)[Math.floor(times.length / 2)]);
      const file = path.join(out, `${name}-${format}.png`);
      await fs.writeFile(file, buf);
      console.log(`${file} ${ms}ms ${Math.round(buf.length / 1024)}KB`);
      small.push({ name, format, buf });
    }
  }
  // Hoja de contacto a 300 px de ancho (lo que muestra WhatsApp), para mirar todas juntas.
  const sharp = (await import('sharp')).default;
  for (const format of ['wide', 'square'] as const) {
    const items = small.filter((s) => s.format === format);
    const w = 300;
    const h = format === 'wide' ? 158 : 300;
    const gap = 16;
    const cols = 3;
    const rows = Math.ceil(items.length / cols);
    const tiles = await Promise.all(items.map((s) => sharp(s.buf).resize(w, h).png().toBuffer()));
    const sheet = await sharp({ create: { width: cols * (w + gap) + gap, height: rows * (h + gap) + gap, channels: 3, background: '#e9e9e9' } })
      .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (w + gap), top: gap + Math.floor(i / cols) * (h + gap) })))
      .png()
      .toBuffer();
    await fs.writeFile(path.join(out, `sheet-300-${format}.png`), sheet);
  }
}

void main();
