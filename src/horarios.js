// ponytail: offset fijo -06:00 (México sin horario de verano desde 2022); usar Intl si vuelve.
const OFFSET = -6 * 3600e3;
const MIN = 60e3;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const toLocal = d => new Date(d.getTime() + OFFSET); // campos UTC = hora local
const hhmm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const overlaps = (s, e, busy) => busy.some(b => s < b.end && b.start < e);

// Inicio (UTC) de cada bloque de un día local, dado el medianoche local como Date UTC.
function dayBlocks(midnight, horario) {
  const out = [];
  for (let m = hhmm(horario.inicio); m + horario.bloqueMin <= hhmm(horario.fin); m += horario.bloqueMin) {
    out.push(new Date(midnight.getTime() + m * MIN));
  }
  return out;
}

export function enHorario(date, now, horario) {
  const l = toLocal(date);
  const mins = l.getUTCHours() * 60 + l.getUTCMinutes();
  const ini = hhmm(horario.inicio);
  return horario.dias.includes(l.getUTCDay())
    && l.getUTCSeconds() === 0 && l.getUTCMilliseconds() === 0
    && mins >= ini && mins + horario.bloqueMin <= hhmm(horario.fin)
    && (mins - ini) % horario.bloqueMin === 0
    && date.getTime() >= now.getTime() + horario.anticipacionMin * MIN;
}

export function freeSlots({ busy, now, horario }) {
  const minStart = now.getTime() + horario.anticipacionMin * MIN;
  const l = toLocal(now);
  const today = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - OFFSET;
  const perDay = [];
  for (let i = 0; i <= horario.ventanaDias; i++) {
    const midnight = new Date(today + i * 86400e3);
    if (!horario.dias.includes(toLocal(midnight).getUTCDay())) continue;
    const free = dayBlocks(midnight, horario).filter(s =>
      s.getTime() >= minStart && !overlaps(s, new Date(s.getTime() + horario.bloqueMin * MIN), busy));
    if (free.length) perDay.push(free);
  }
  // Primero un hueco por día distinto; si no alcanzan los días, completa con los siguientes huecos.
  const picked = perDay.map(d => d[0]).slice(0, horario.opciones);
  for (const d of perDay) for (const s of d.slice(1)) if (picked.length < horario.opciones) picked.push(s);
  return picked.sort((a, b) => a - b);
}

export function formatSlot(date) {
  const l = toLocal(date);
  const mm = String(l.getUTCMinutes()).padStart(2, '0');
  return `${DIAS[l.getUTCDay()]} ${l.getUTCDate()} de ${MESES[l.getUTCMonth()]}, ${l.getUTCHours()}:${mm}`;
}
