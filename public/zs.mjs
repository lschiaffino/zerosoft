/*
 * zerosoft Analytics como módulo ES (para bundlers o <script type="module">):
 *   import zs from 'https://zerosoft.ai/zs.mjs';
 *   zs.init('zsp_…');
 * Carga zs.js y apunta los envíos al mismo origen del que se importó.
 */
import './zs.js';

const zs = window.zs;
const host = new URL(import.meta.url).origin;
const init = zs.init;
zs.init = (key, opts = {}) => init(key, { api_host: host, ...opts });

export default zs;
export { zs };
