import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, guardPrice, TEXTO_PRECIO } from '../src/agent.js';
import { buildSystemPrompt, TEXTO_ROBOT } from '../src/prompt.js';
import { openDb, createLead, getLead } from '../src/db.js';

const horario = { dias: [1, 2, 3, 4, 5], inicio: '10:00', fin: '18:00', bloqueMin: 30, anticipacionMin: 120, ventanaDias: 7, opciones: 3 };
const tenant = {
  id: 'havoc', nombre: 'HAVOC', horario, preguntas: ['¿Qué necesita?'], avisoPrivacidad: 'https://x/aviso',
  ficha: { servicios: ['Apps web a medida', 'Apps móviles', 'Landings y sitios web', 'Integraciones', 'Deploy, hosting y mantenimiento'].map(nombre => ({ nombre, descripcion: 'd' })), voz: 'precisa', ubicacion: 'Uruapan' },
};
const now = new Date('2026-10-26T09:00:00-06:00');
const SLOT = '2026-10-26T17:00:00.000Z'; // 11:00 local

// LLM falso: cada llamada devuelve la siguiente respuesta guionada.
function fakeLlm(script) {
  const calls = [];
  return { calls, create: async params => { calls.push(structuredClone(params)); return script.shift() ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'fin' }] }; } };
}
const toolUse = (name, input, id = 't' + Math.random()) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const text = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });

function setup(script, busy = []) {
  const db = openDb(':memory:');
  const lead = createLead(db, 'havoc', '524523334444');
  const events = [], notes = [];
  const deps = {
    llm: fakeLlm(script), db, now,
    calendar: { busy: async () => busy, createEvent: async e => events.push(e) },
    notifier: { notify: async (...a) => notes.push(a) },
  };
  return { db, lead, events, notes, deps, history: [{ role: 'user', content: 'quiero una llamada' }] };
}

test('consultar_horarios devuelve opciones y el texto final se regresa', async () => {
  const s = setup([toolUse('consultar_horarios', {}), text('¿Le acomoda el lunes 11:00?')]);
  const out = await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.equal(out, '¿Le acomoda el lunes 11:00?');
  const toolResult = s.deps.llm.calls[1].messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.match(toolResult.content, /lunes 26 de octubre, 11:00/);
});

test('agendar_llamada en hueco ocupado no crea evento', async () => {
  const busy = [{ start: new Date(SLOT), end: new Date('2026-10-26T17:30:00Z') }];
  const s = setup([toolUse('agendar_llamada', { iso: SLOT }), text('ok')], busy);
  await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.equal(s.events.length, 0);
  const r = JSON.parse(s.deps.llm.calls[1].messages.at(-1).content[0].content);
  assert.equal(r.error, 'ocupado');
  assert.ok(r.opciones.length > 0);
});

test('agendar_llamada fuera de horario se rechaza', async () => {
  const s = setup([toolUse('agendar_llamada', { iso: '2026-10-31T17:00:00.000Z' }), text('ok')]);
  await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.equal(s.events.length, 0);
  assert.equal(JSON.parse(s.deps.llm.calls[1].messages.at(-1).content[0].content).error, 'fuera_de_horario');
});

test('agendar_llamada libre crea evento, marca agendado y avisa una vez', async () => {
  const s = setup([toolUse('registrar_lead', { nombre: 'Ana', necesidad: 'app' }), toolUse('agendar_llamada', { iso: SLOT }), text('Listo')]);
  await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].title, 'Llamada HAVOC — Ana');
  assert.equal(s.events[0].start.toISOString(), SLOT);
  const l = getLead(s.db, 'havoc', '524523334444');
  assert.equal(l.estado, 'agendado');
  assert.equal(l.llamada_inicio, SLOT);
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0][1], 'lead');
  assert.equal(s.notes[0][2].nombre, 'Ana');
});

test('cerrar_sin_llamada avisa solo si hay datos útiles', async () => {
  const s = setup([toolUse('cerrar_sin_llamada', {}), text('ok')]);
  await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.equal(getLead(s.db, 'havoc', '524523334444').estado, 'cerrado');
  assert.equal(s.notes.length, 0);
});

test('solicitar_cambio y marcar_cliente_urgente avisan', async () => {
  const s = setup([toolUse('solicitar_cambio', { detalle: 'moverla al martes' }), toolUse('marcar_cliente_urgente', { empresa: 'Gioval' }), text('ok')]);
  await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.deepEqual(s.notes.map(n => [n[1], n[4]]), [['cambio', 'moverla al martes'], ['urgente', 'Gioval']]);
  assert.equal(getLead(s.db, 'havoc', '524523334444').es_cliente, 1);
});

test('el loop corta a 5 vueltas', async () => {
  const s = setup(Array.from({ length: 10 }, () => toolUse('consultar_horarios', {})));
  const out = await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps });
  assert.equal(s.deps.llm.calls.length, 5);
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});

test('refusal → respuesta de llamada', async () => {
  const s = setup([{ stop_reason: 'refusal', content: [] }]);
  assert.equal(await runAgent({ tenant, lead: s.lead, history: s.history, deps: s.deps }), TEXTO_PRECIO);
});

test('guardPrice tapa precios y tiempos de entrega', () => {
  assert.equal(guardPrice('Una landing cuesta $8,000'), TEXTO_PRECIO);
  assert.equal(guardPrice('Serían unos 15 mil pesos'), TEXTO_PRECIO);
  assert.equal(guardPrice('La entrega es en 3 semanas'), TEXTO_PRECIO);
  assert.equal(guardPrice('Le llamo el lunes a las 11:00'), 'Le llamo el lunes a las 11:00');
});

test('system prompt incluye texto de robot verbatim, servicios y fecha', () => {
  const p = buildSystemPrompt(tenant, now);
  assert.ok(p.includes(TEXTO_ROBOT.replace('{nombre}', 'HAVOC')));
  for (const s of tenant.ficha.servicios) assert.ok(p.includes(s.nombre));
  assert.match(p, /lunes 26 de octubre/);
});
