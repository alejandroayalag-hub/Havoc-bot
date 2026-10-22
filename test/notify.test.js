import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier } from '../src/notify.js';

const tenant = {
  nombre: 'HAVOC', dueno: { telefono: '524521112222', correo: 'ventas@havocdev.mx' },
  mail: { host: 'h', port: 465, user: 'u', pass: 'p', from: 'Bot <ventas@havocdev.mx>' },
  plantillas: { lead: 'nuevo_lead', urgente: 'cliente_urgente' },
};
const lead = { phone: '524523334444', nombre: 'Ana', necesidad: 'app de inventario', urgencia: 'este mes', llamada_inicio: '2026-10-26T17:00:00.000Z' };
const conv = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: '¿en qué le ayudo?' }];

function setup({ waFails = false, mailFails = false } = {}) {
  const wa = [], mails = [];
  const notifier = createNotifier({
    wa: { sendTemplate: async (...a) => { if (waFails) throw new Error('wa down'); wa.push(a); } },
    mailer: { createTransport: () => ({ sendMail: async m => { if (mailFails) throw new Error('smtp down'); mails.push(m); } }) },
  });
  return { notifier, wa, mails };
}

test('lead: WhatsApp con plantilla y correo con conversación', async () => {
  const { notifier, wa, mails } = setup();
  await notifier.notify(tenant, 'lead', lead, conv);
  assert.deepEqual(wa[0].slice(1), ['524521112222', 'nuevo_lead', ['Ana', 'app de inventario', 'este mes', '524523334444', 'lunes 26 de octubre, 11:00']]);
  assert.equal(mails[0].to, 'ventas@havocdev.mx');
  assert.equal(mails[0].subject, '[Lead] Ana — app de inventario');
  assert.match(mails[0].text, /lunes 26 de octubre, 11:00/);
  assert.match(mails[0].text, /Cliente: hola/);
  assert.match(mails[0].text, /Asistente: ¿en qué le ayudo\?/);
});

test('incompleto y error: solo correo', async () => {
  const { notifier, wa, mails } = setup();
  await notifier.notify(tenant, 'incompleto', { ...lead, nombre: null, llamada_inicio: null }, conv);
  await notifier.notify(tenant, 'error', lead, conv, 'Claude timeout');
  assert.equal(wa.length, 0);
  assert.equal(mails[0].subject, '[Lead incompleto] 524523334444 — app de inventario');
  assert.equal(mails[1].subject, '[Error bot] 524523334444');
  assert.match(mails[1].text, /Claude timeout/);
});

test('urgente: plantilla cliente_urgente con empresa y último mensaje', async () => {
  const { notifier, wa, mails } = setup();
  await notifier.notify(tenant, 'urgente', lead, conv, 'Gioval');
  assert.deepEqual(wa[0].slice(1), ['524521112222', 'cliente_urgente', ['Gioval', '524523334444', 'hola']]);
  assert.equal(mails[0].subject, '[URGENTE] Cliente Gioval — 524523334444');
});

test('cambio: plantilla urgente con empresa "Cambio de llamada"', async () => {
  const { notifier, wa, mails } = setup();
  await notifier.notify(tenant, 'cambio', lead, conv, 'quiere moverla al martes');
  assert.equal(wa[0][3][0], 'Cambio de llamada');
  assert.equal(mails[0].subject, '[Cambio de llamada] Ana — 524523334444');
  assert.match(mails[0].text, /quiere moverla al martes/);
});

test('falla WhatsApp: el correo sale igual y no lanza', async () => {
  const { notifier, mails } = setup({ waFails: true });
  await notifier.notify(tenant, 'lead', lead, conv);
  assert.equal(mails.length, 1);
});

test('fallan ambos canales: lanza', async () => {
  const { notifier } = setup({ waFails: true, mailFails: true });
  await assert.rejects(notifier.notify(tenant, 'lead', lead, conv));
});

test('dueño PENDIENTE: se omite WhatsApp', async () => {
  const { notifier, wa, mails } = setup();
  await notifier.notify({ ...tenant, dueno: { ...tenant.dueno, telefono: 'PENDIENTE' } }, 'lead', lead, conv);
  assert.equal(wa.length, 0);
  assert.equal(mails.length, 1);
});
