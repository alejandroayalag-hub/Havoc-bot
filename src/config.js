import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HORARIO = { dias: [1, 2, 3, 4, 5], inicio: '10:00', fin: '18:00', bloqueMin: 30, anticipacionMin: 120, ventanaDias: 7, opciones: 3 };

export function normalizePhone(s) {
  let d = String(s).replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
  if (d.length === 10) d = '52' + d;
  return d;
}

function secret(env, name) {
  if (!env[name]) throw new Error(`Falta variable de entorno ${name}`);
  return env[name];
}

export function loadTenants(dir, env = process.env) {
  const tenants = new Map();
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const k of ['id', 'nombre', 'phoneNumberId', 'waTokenEnv', 'dueno', 'mail', 'calendario', 'ficha', 'avisoPrivacidad']) {
      if (!t[k]) throw new Error(`Tenant ${f}: falta ${k}`);
    }
    if (t.dueno.telefono === 'PENDIENTE') {
      if (env.NODE_ENV === 'production') throw new Error(`Tenant ${t.id}: dueno.telefono PENDIENTE`);
    } else {
      t.dueno.telefono = normalizePhone(t.dueno.telefono);
    }
    t.waToken = secret(env, t.waTokenEnv);
    t.mail.pass = secret(env, t.mail.passEnv);
    t.calendario.pass = secret(env, t.calendario.passEnv);
    t.horario = { ...HORARIO, ...t.horario };
    t.preguntas ??= [];
    t.retencionMeses ??= 12;
    t.clientes = (t.clientes ?? []).map(c => ({ ...c, telefonos: c.telefonos.map(normalizePhone) }));
    tenants.set(String(t.phoneNumberId), t);
  }
  return tenants;
}
