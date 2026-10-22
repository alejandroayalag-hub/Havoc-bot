import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, markSeen, createLead, getLead, updateLead, addMessage, recentMessages,
  syncClientes, findCliente, inactiveLeads, purge } from '../src/db.js';

test('markSeen es true la primera vez y false después', () => {
  const db = openDb(':memory:');
  assert.equal(markSeen(db, 'm1'), true);
  assert.equal(markSeen(db, 'm1'), false);
});

test('createLead/getLead/updateLead round-trip', () => {
  const db = openDb(':memory:');
  const l = createLead(db, 'havoc', '524521112222');
  assert.equal(l.estado, 'abierto');
  updateLead(db, l.id, { nombre: 'Ana', necesidad: 'app' });
  const g = getLead(db, 'havoc', '524521112222');
  assert.equal(g.nombre, 'Ana');
  assert.equal(g.necesidad, 'app');
  assert.equal(getLead(db, 'ata', '524521112222'), undefined);
});

test('recentMessages devuelve los últimos n en orden cronológico', () => {
  const db = openDb(':memory:');
  const l = createLead(db, 'havoc', '52');
  for (let i = 1; i <= 5; i++) addMessage(db, l.id, i % 2 ? 'user' : 'assistant', `m${i}`);
  assert.deepEqual(recentMessages(db, l.id, 3).map(m => m.content), ['m3', 'm4', 'm5']);
});

test('findCliente por teléfono normalizado, por tenant', () => {
  const db = openDb(':memory:');
  syncClientes(db, 'havoc', [{ empresa: 'Gioval', telefonos: ['524523334444'] }]);
  assert.equal(findCliente(db, 'havoc', '524523334444').empresa, 'Gioval');
  assert.equal(findCliente(db, 'ata', '524523334444'), undefined);
  syncClientes(db, 'havoc', []);
  assert.equal(findCliente(db, 'havoc', '524523334444'), undefined);
});

test('inactiveLeads y purge respetan estado y fechas', () => {
  const db = openDb(':memory:');
  const a = createLead(db, 'havoc', '1');
  const b = createLead(db, 'havoc', '2');
  updateLead(db, a.id, { ultima_actividad: '2025-01-01T00:00:00.000Z' });
  updateLead(db, b.id, { ultima_actividad: '2025-01-01T00:00:00.000Z', estado: 'cerrado' });
  addMessage(db, b.id, 'user', 'hola');
  assert.deepEqual(inactiveLeads(db, '2026-01-01T00:00:00.000Z').map(l => l.id), [a.id]);
  assert.equal(purge(db, '2026-01-01T00:00:00.000Z'), 1);
  assert.ok(getLead(db, 'havoc', '1'));
  assert.equal(getLead(db, 'havoc', '2'), undefined);
  assert.equal(recentMessages(db, b.id).length, 0);
});
