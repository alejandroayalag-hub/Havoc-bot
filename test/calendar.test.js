import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendar, isFree, parseIcsTimes } from '../src/calendar.js';

const ics = (s, e) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\n${s}\r\n${e}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

test('parseIcsTimes entiende UTC, TZID y día completo', () => {
  assert.deepEqual(parseIcsTimes(ics('DTSTART:20261026T170000Z', 'DTEND:20261026T173000Z')),
    { start: new Date('2026-10-26T17:00:00Z'), end: new Date('2026-10-26T17:30:00Z') });
  assert.deepEqual(parseIcsTimes(ics('DTSTART;TZID=America/Mexico_City:20261026T110000', 'DTEND;TZID=America/Mexico_City:20261026T113000')),
    { start: new Date('2026-10-26T17:00:00Z'), end: new Date('2026-10-26T17:30:00Z') });
  assert.deepEqual(parseIcsTimes(ics('DTSTART;VALUE=DATE:20261026', 'DTEND;VALUE=DATE:20261027')),
    { start: new Date('2026-10-26T06:00:00Z'), end: new Date('2026-10-27T06:00:00Z') });
});

function fakeClient(objects) {
  const created = [];
  return {
    created,
    factory: async () => ({
      fetchCalendars: async () => [{ url: 'u1', displayName: 'Calendar' }],
      fetchCalendarObjects: async ({ timeRange }) => { assert.ok(timeRange.start && timeRange.end); return objects.map(data => ({ data })); },
      createCalendarObject: async (o) => { created.push(o); return { ok: true }; },
    }),
  };
}

test('busy devuelve intervalos y isFree detecta traslape', async () => {
  const f = fakeClient([ics('DTSTART:20261026T170000Z', 'DTEND:20261026T180000Z')]);
  const cal = createCalendar({ url: 'x', user: 'u', pass: 'p' }, f.factory);
  const busy = await cal.busy(new Date('2026-10-26T00:00:00Z'), new Date('2026-10-27T00:00:00Z'));
  assert.equal(busy.length, 1);
  assert.equal(await isFree(cal, new Date('2026-10-26T17:30:00Z'), new Date('2026-10-26T18:00:00Z')), false);
  assert.equal(await isFree(cal, new Date('2026-10-26T18:00:00Z'), new Date('2026-10-26T18:30:00Z')), true);
});

test('createEvent manda ICS con SUMMARY y horas UTC', async () => {
  const f = fakeClient([]);
  const cal = createCalendar({ url: 'x', user: 'u', pass: 'p' }, f.factory);
  await cal.createEvent({ start: new Date('2026-10-26T17:00:00Z'), end: new Date('2026-10-26T17:30:00Z'), title: 'Llamada HAVOC — Ana', description: 'Tel 52\nquiere app' });
  const o = f.created[0];
  assert.match(o.filename, /\.ics$/);
  assert.match(o.iCalString, /SUMMARY:Llamada HAVOC — Ana/);
  assert.match(o.iCalString, /DTSTART:20261026T170000Z/);
  assert.match(o.iCalString, /DTEND:20261026T173000Z/);
  assert.match(o.iCalString, /DESCRIPTION:Tel 52\\nquiere app/);
});
