import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeSlots, formatSlot, enHorario } from '../src/horarios.js';

const horario = { dias: [1, 2, 3, 4, 5], inicio: '10:00', fin: '18:00', bloqueMin: 30, anticipacionMin: 120, ventanaDias: 7, opciones: 3 };
const local = s => new Date(s + '-06:00');
const iso = ds => ds.map(d => d.toISOString());

test('respeta anticipación de 2 h y reparte en días distintos', () => {
  const r = freeSlots({ busy: [], now: local('2026-10-26T09:00:00'), horario });
  assert.deepEqual(iso(r), iso([local('2026-10-26T11:00:00'), local('2026-10-27T10:00:00'), local('2026-10-28T10:00:00')]));
});

test('salta huecos ocupados', () => {
  const busy = [{ start: local('2026-10-26T11:00:00'), end: local('2026-10-26T12:00:00') }];
  const r = freeSlots({ busy, now: local('2026-10-26T09:00:00'), horario });
  assert.equal(r[0].toISOString(), local('2026-10-26T12:00:00').toISOString());
});

test('viernes tarde → lunes; nunca fin de semana', () => {
  const r = freeSlots({ busy: [], now: local('2026-10-30T17:00:00'), horario });
  assert.equal(r[0].toISOString(), local('2026-11-02T10:00:00').toISOString());
  for (const d of r) assert.ok(![0, 6].includes(new Date(d.getTime() - 6 * 3600e3).getUTCDay()));
});

test('último bloque termina a las 18:00', () => {
  const busy = [{ start: local('2026-10-26T10:00:00'), end: local('2026-10-26T17:30:00') }];
  const r = freeSlots({ busy, now: local('2026-10-26T07:00:00'), horario });
  assert.equal(r[0].toISOString(), local('2026-10-26T17:30:00').toISOString());
});

test('formatSlot en español, hora local', () => {
  assert.equal(formatSlot(local('2026-10-26T10:30:00')), 'lunes 26 de octubre, 10:30');
});

test('enHorario valida día, hora, alineación y anticipación', () => {
  const now = local('2026-10-26T09:00:00');
  assert.equal(enHorario(local('2026-10-26T11:00:00'), now, horario), true);
  assert.equal(enHorario(local('2026-10-26T10:00:00'), now, horario), false);
  assert.equal(enHorario(local('2026-10-31T11:00:00'), now, horario), false);
  assert.equal(enHorario(local('2026-10-26T11:15:00'), now, horario), false);
  assert.equal(enHorario(local('2026-10-26T18:00:00'), now, horario), false);
});
