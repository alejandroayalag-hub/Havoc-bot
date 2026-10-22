import { randomUUID } from 'node:crypto';
import { createDAVClient } from 'tsdav';

const defaultFactory = cfg => createDAVClient({
  serverUrl: cfg.url,
  credentials: { username: cfg.user, password: cfg.pass },
  authMethod: 'Basic',
  defaultAccountType: 'caldav',
});

// ponytail: TZID se asume -06:00 y RRULE se ignora; usar ical.js si el calendario trae recurrentes.
function icsDate(line) {
  const v = line.slice(line.lastIndexOf(':') + 1).trim();
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/) ?? [];
  if (!y) return null;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : '-06:00'}`);
}

export function parseIcsTimes(ics) {
  const lines = ics.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const start = icsDate(lines.find(l => l.startsWith('DTSTART')) ?? '');
  const endLine = lines.find(l => l.startsWith('DTEND'));
  const end = endLine ? icsDate(endLine) : start && new Date(start.getTime() + 3600e3);
  return start ? { start, end } : null;
}

const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function createCalendar(cfg, factory = defaultFactory) {
  let ctx;
  async function calendar() {
    if (!ctx) {
      const client = await factory(cfg);
      const cals = await client.fetchCalendars();
      const cal = cals.find(c => c.displayName === cfg.nombre) ?? cals[0];
      if (!cal) throw new Error('CalDAV: no hay calendarios');
      ctx = { client, cal };
    }
    return ctx;
  }
  return {
    async busy(from, to) {
      const { client, cal } = await calendar();
      const objs = await client.fetchCalendarObjects({ calendar: cal, timeRange: { start: from.toISOString(), end: to.toISOString() } });
      return objs.map(o => parseIcsTimes(o.data ?? '')).filter(Boolean);
    },
    async createEvent({ start, end, title, description }) {
      const { client, cal } = await calendar();
      const uid = randomUUID();
      const iCalString = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HAVOC//bot//ES', 'BEGIN:VEVENT',
        `UID:${uid}`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`,
        `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(description)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
      const res = await client.createCalendarObject({ calendar: cal, filename: `${uid}.ics`, iCalString });
      if (res && res.ok === false) throw new Error(`CalDAV: no se pudo crear evento (${res.status})`);
    },
  };
}

export async function isFree(calendar, start, end) {
  return !(await calendar.busy(start, end)).some(b => start < b.end && b.start < end);
}
