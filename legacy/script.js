/* ============================================
   ZEROSOFTWARE.AI — Un cero hecho de ceros.
   ============================================ */

(() => {
  const canvas = document.getElementById('zeros');
  const hero = document.getElementById('hero');
  if (!canvas || !hero) return;

  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0;
  let H = 0;
  let particles = [];
  const mouse = { x: -9999, y: -9999 };

  function glyphCenter() {
    if (W > 900) return { x: W * 0.67, y: H * 0.44 };
    return { x: W * 0.5, y: H * 0.3 };
  }

  function buildParticles() {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d', { willReadFrequently: true });

    const size = Math.min(W, H) * (W > 900 ? 0.92 : 0.6);
    const { x: cx, y: cy } = glyphCenter();

    octx.fillStyle = '#000';
    octx.font = `500 ${size}px "IBM Plex Mono", monospace`;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText('0', cx, cy);

    const img = octx.getImageData(0, 0, W, H).data;
    const gap = Math.max(8, Math.round(size / 56));

    particles = [];
    for (let y = 0; y < H; y += gap) {
      for (let x = 0; x < W; x += gap) {
        if (img[(y * W + x) * 4 + 3] > 120) {
          particles.push({
            hx: x,
            hy: y,
            x: x + (Math.random() - 0.5) * W * 0.9,
            y: y + (Math.random() - 0.5) * H * 0.9,
            vx: 0,
            vy: 0,
            s: gap * 1.15,
            o: 0.45 + Math.random() * 0.45,
            ph: Math.random() * Math.PI * 2,
          });
        }
      }
    }
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of particles) {
      ctx.font = `500 ${p.s}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = `rgba(13, 13, 13, ${p.o})`;
      ctx.fillText('0', p.hx, p.hy);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
    if (reduced) drawStatic();
  }

  const t0 = performance.now();

  function tick(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const R = 130;
    for (const p of particles) {
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < R * R && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = ((R - d) / R) * 1.9;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }

      p.vx += (p.hx - p.x) * 0.014;
      p.vy += (p.hy - p.y) * 0.014;
      p.vx *= 0.86;
      p.vy *= 0.86;
      p.x += p.vx;
      p.y += p.vy;

      const near = Math.max(0, 1 - Math.sqrt(d2) / 240);
      const wobX = Math.sin(t * 1.4 + p.ph) * 1.1;
      const wobY = Math.cos(t * 1.2 + p.ph) * 1.1;
      const fs = Math.round(p.s * (1 + near * 0.8));

      ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = `rgba(13, 13, 13, ${Math.min(1, p.o + near * 0.4)})`;
      ctx.fillText('0', p.x + wobX, p.y + wobY);
    }
    requestAnimationFrame(tick);
  }

  hero.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });
  hero.addEventListener('pointerleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  function start() {
    resize();
    if (!reduced) requestAnimationFrame(tick);
  }

  // Esperar a que cargue la mono para muestrear el "0" con su forma real.
  if (document.fonts && document.fonts.ready) {
    Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 900)),
    ]).then(start);
  } else {
    start();
  }

  // Reveal on scroll
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('visible');
          io.unobserve(en.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
})();
