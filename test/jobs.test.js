import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarInactivos, purgar } from '../src/jobs.js';
import { openDb, createLead, updateLead, getLead, addMessage } from '../src/db.js';

const tenant = { id: 'havoc', retencionMeses: 12 };
const tenants = new Map([['111', tenant]]);
const now = new Date('2026-10-26T12:00:00Z');

test('cierra inactivos >24 h y avisa incompleto solo si hay datos y no es cliente', async () => {
  const db = openDb(':memory:');
  const viejo = '2026-10-25T10:00:00Z';
  const a = createLead(db, 'havoc', '1'); updateLead(db, a.id, { necesidad: 'app', ultima_actividad: viejo });
  const b = createLead(db, 'havoc', '2'); updateLead(db, b.id, { ultima_actividad: viejo });
  const c = createLead(db, 'havoc', '3'); updateLead(db, c.id, { nombre: 'X', es_cliente: 1, ultima_actividad: viejo });
  const d = createLead(db, 'havoc', '4'); updateLead(db, d.id, { necesidad: 'web', ultima_actividad: '2026-10-26T10:00:00Z' });
  addMessage(db, a.id, 'user', 'quiero app');
  const notes = [];
  await cerrarInactivos({ db, tenants, notifier: { notify: async (...x) => notes.push(x) } }, now);
  assert.deepEqual(['1', '2', '3', '4'].map(p => getLead(db, 'havoc', p).estado), ['cerrado', 'cerrado', 'cerrado', 'abierto']);
  assert.equal(notes.length, 1);
  assert.equal(notes[0][1], 'incompleto');
  assert.deepEqual(notes[0][3], [{ role: 'user', content: 'quiero app' }]);
});

test('un aviso fallido no detiene el cierre de los demás', async () => {
  const db = openDb(':memory:');
  for (const p of ['1', '2']) { const l = createLead(db, 'havoc', p); updateLead(db, l.id, { necesidad: 'x', ultima_actividad: '2026-01-01T00:00:00Z' }); }
  await cerrarInactivos({ db, tenants, notifier: { notify: async () => { throw new Error('smtp'); } } }, now);
  assert.equal(getLead(db, 'havoc', '2').estado, 'cerrado');
});

test('purgar borra cerrados más viejos que la retención del tenant', () => {
  const db = openDb(':memory:');
  const a = createLead(db, 'havoc', '1'); updateLead(db, a.id, { estado: 'cerrado', ultima_actividad: '2025-09-01T00:00:00Z' });
  const b = createLead(db, 'havoc', '2'); updateLead(db, b.id, { estado: 'cerrado', ultima_actividad: '2025-12-01T00:00:00Z' });
  const c = createLead(db, 'ata', '1'); updateLead(db, c.id, { estado: 'cerrado', ultima_actividad: '2025-09-01T00:00:00Z' });
  purgar(db, tenants, now);
  assert.equal(getLead(db, 'havoc', '1'), undefined);
  assert.ok(getLead(db, 'havoc', '2'));
  assert.ok(getLead(db, 'ata', '1'), 'otro tenant no se toca');
});
