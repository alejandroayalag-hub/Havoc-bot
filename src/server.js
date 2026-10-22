import { existsSync } from 'node:fs';
import { loadTenants } from './config.js';
import { openDb, syncClientes } from './db.js';
import { createWhatsApp } from './whatsapp.js';
import { createNotifier } from './notify.js';
import { createCalendar } from './calendar.js';
import { createLlm, runAgent } from './agent.js';
import { handleMessage } from './handler.js';
import { cerrarInactivos, purgar } from './jobs.js';
import { createApp } from './server-app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
for (const k of ['WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'ANTHROPIC_API_KEY']) if (!process.env[k]) throw new Error(`Falta ${k}`);

const tenants = loadTenants('tenants');
const db = openDb(process.env.DB_PATH ?? './havoc-bot.db');
for (const t of tenants.values()) syncClientes(db, t.id, t.clientes);

const wa = createWhatsApp();
const deps = {
  tenants, db, wa, now: () => new Date(),
  notifier: createNotifier({ wa }),
  calendars: new Map([...tenants.values()].map(t => [t.id, createCalendar(t.calendario)])),
  llm: createLlm(),
  runAgent,
};

const app = createApp({ appSecret: process.env.WA_APP_SECRET, verifyToken: process.env.WA_VERIFY_TOKEN, handle: m => handleMessage(m, deps) });
const port = Number(process.env.PORT ?? 3017);
app.listen(port, '127.0.0.1', () => console.log(`havoc-bot en 127.0.0.1:${port} (${tenants.size} tenant/s)`));

setInterval(() => {
  const now = new Date();
  cerrarInactivos(deps, now).catch(e => console.error('job cerrar:', e));
  try { purgar(db, tenants, now); } catch (e) { console.error('job purgar:', e); }
}, 15 * 60e3);
