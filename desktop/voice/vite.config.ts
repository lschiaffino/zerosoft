import { defineConfig } from 'vite';

// Tauri espera el dev server en 1420 y el build en dist/.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', target: 'es2021' },
});
