import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS procesados (id TEXT PRIMARY KEY, creado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, phone TEXT NOT NULL,
  nombre TEXT, necesidad TEXT, negocio TEXT, urgencia TEXT,
  estado TEXT NOT NULL DEFAULT 'abierto', es_cliente INTEGER NOT NULL DEFAULT 0,
  llamada_inicio TEXT, aviso_privacidad_enviado INTEGER NOT NULL DEFAULT 0,
  ultima_actividad TEXT NOT NULL, creado TEXT NOT NULL,
  UNIQUE (tenant_id, phone));
CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, creado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clientes (tenant_id TEXT NOT NULL, phone TEXT NOT NULL, empresa TEXT NOT NULL,
  PRIMARY KEY (tenant_id, phone));
`;
const CAMPOS = ['nombre', 'necesidad', 'negocio', 'urgencia', 'estado', 'es_cliente', 'llamada_inicio', 'aviso_privacidad_enviado', 'ultima_actividad'];
const now = () => new Date().toISOString();

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;' + SCHEMA);
  return db;
}

export const markSeen = (db, id) =>
  db.prepare('INSERT OR IGNORE INTO procesados (id, creado) VALUES (?, ?)').run(id, now()).changes === 1;

export const getLead = (db, tenantId, phone) =>
  db.prepare('SELECT * FROM leads WHERE tenant_id = ? AND phone = ?').get(tenantId, phone);

export function createLead(db, tenantId, phone) {
  const t = now();
  db.prepare('INSERT INTO leads (tenant_id, phone, ultima_actividad, creado) VALUES (?, ?, ?, ?)').run(tenantId, phone, t, t);
  return getLead(db, tenantId, phone);
}

export function updateLead(db, id, fields) {
  const keys = Object.keys(fields).filter(k => CAMPOS.includes(k));
  if (!keys.length) return;
  db.prepare(`UPDATE leads SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

export const addMessage = (db, leadId, role, content) =>
  db.prepare('INSERT INTO mensajes (lead_id, role, content, creado) VALUES (?, ?, ?, ?)').run(leadId, role, content, now());

export const recentMessages = (db, leadId, n = 20) =>
  db.prepare('SELECT role, content FROM (SELECT * FROM mensajes WHERE lead_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id')
    .all(leadId, n).map(r => ({ role: r.role, content: r.content }));

export function syncClientes(db, tenantId, clientes) {
  db.prepare('DELETE FROM clientes WHERE tenant_id = ?').run(tenantId);
  const ins = db.prepare('INSERT OR REPLACE INTO clientes (tenant_id, phone, empresa) VALUES (?, ?, ?)');
  for (const c of clientes) for (const p of c.telefonos) ins.run(tenantId, p, c.empresa);
}

export const findCliente = (db, tenantId, phone) =>
  db.prepare('SELECT empresa FROM clientes WHERE tenant_id = ? AND phone = ?').get(tenantId, phone);

export const inactiveLeads = (db, beforeIso) =>
  db.prepare("SELECT * FROM leads WHERE estado = 'abierto' AND ultima_actividad < ?").all(beforeIso);

export function purge(db, beforeIso) {
  db.prepare('DELETE FROM procesados WHERE creado < ?').run(beforeIso);
  return db.prepare("DELETE FROM leads WHERE estado != 'abierto' AND ultima_actividad < ?").run(beforeIso).changes;
}
