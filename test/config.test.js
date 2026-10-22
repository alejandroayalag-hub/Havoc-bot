import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, loadTenants } from '../src/config.js';

const dir = new URL('./fixtures/', import.meta.url).pathname;
const env = { DEMO_WA_TOKEN: 'tok', DEMO_MAIL_PASS: 'pw' };

test('normalizePhone unifica formatos MX', () => {
  assert.equal(normalizePhone('+52 452 174 1368'), '524521741368');
  assert.equal(normalizePhone('5214521741368'), '524521741368');
  assert.equal(normalizePhone('4521741368'), '524521741368');
});

test('loadTenants indexa por phoneNumberId y resuelve secretos y defaults', () => {
  const t = loadTenants(dir, env).get('111');
  assert.equal(t.waToken, 'tok');
  assert.equal(t.mail.pass, 'pw');
  assert.equal(t.calendario.pass, 'pw');
  assert.equal(t.dueno.telefono, '524521112222');
  assert.deepEqual(t.clientes[0].telefonos, ['524523334444']);
  assert.equal(t.horario.inicio, '10:00');
  assert.equal(t.horario.opciones, 3);
  assert.equal(t.retencionMeses, 12);
});

test('loadTenants lanza si falta variable de entorno', () => {
  assert.throws(() => loadTenants(dir, { DEMO_MAIL_PASS: 'pw' }), /DEMO_WA_TOKEN/);
});

test('loadTenants lanza con telefono PENDIENTE solo en producción', () => {
  const tmp = new URL('./fixtures-pend/', import.meta.url).pathname;
  assert.throws(() => loadTenants(tmp, { ...env, NODE_ENV: 'production' }), /PENDIENTE/);
  assert.doesNotThrow(() => loadTenants(tmp, env));
});
