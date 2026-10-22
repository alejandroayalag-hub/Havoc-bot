import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './prompt.js';
import { freeSlots, formatSlot, enHorario } from './horarios.js';
import { isFree } from './calendar.js';
import { getLead, updateLead } from './db.js';

export const MODEL = 'claude-opus-5-5';
const MAX_VUELTAS = 5;
export const TEXTO_PRECIO = 'Cada proyecto es a la medida; costos y tiempos los vemos en una llamada de 30 minutos. ¿Le agendo una?';
export const TEXTO_LLAMADA = 'Para atenderle mejor, lo vemos en una llamada de 30 minutos. ¿Le agendo una?';

// ponytail: regex simple; ampliar con casos reales del log.
const PRECIO = /\$\s?\d|\d+\s?(mil\b|pesos|mxn|usd|d[oó]lares)|\bsemanas?\b.*entrega|entrega.*\b(semanas?|d[ií]as|meses)\b/i;
export const guardPrice = text => (PRECIO.test(text) ? TEXTO_PRECIO : text);

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = description => ({ type: 'string', description });
const TOOLS = [
  { name: 'registrar_lead', description: 'Guarda o actualiza lo que se sabe del prospecto. Llamar en cuanto se conozca algún dato.',
    input_schema: obj({ nombre: str('Nombre de la persona'), necesidad: str('Qué necesita, en una línea'), negocio: str('Giro o nombre del negocio'), urgencia: str('Para cuándo lo quiere') }) },
  { name: 'consultar_horarios', description: 'Devuelve horarios libres para una llamada de 30 minutos.', input_schema: obj({}) },
  { name: 'agendar_llamada', description: 'Agenda la llamada en el horario elegido (usar el iso que devolvió consultar_horarios).',
    input_schema: obj({ iso: str('Inicio en ISO 8601 tal como vino de consultar_horarios') }, ['iso']) },
  { name: 'cerrar_sin_llamada', description: 'El prospecto no quiere llamada; cierra la conversación.', input_schema: obj({}) },
  { name: 'solicitar_cambio', description: 'El prospecto quiere mover o cancelar su llamada; avisa al equipo.',
    input_schema: obj({ detalle: str('Qué pidió exactamente') }, ['detalle']) },
  { name: 'marcar_cliente_urgente', description: 'La persona es cliente actual y necesita soporte; avisa urgente al equipo.',
    input_schema: obj({ empresa: str('Empresa del cliente') }, ['empresa']) },
].map(t => ({ ...t, strict: true }));

export function createLlm(client = new Anthropic()) {
  return {
    create: params => client.beta.messages.create({
      ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    }),
  };
}

async function opciones(tenant, deps) {
  const fin = new Date(deps.now.getTime() + (tenant.horario.ventanaDias + 1) * 86400e3);
  const busy = await deps.calendar.busy(deps.now, fin);
  return freeSlots({ busy, now: deps.now, horario: tenant.horario }).map(d => ({ iso: d.toISOString(), texto: formatSlot(d) }));
}

async function ejecutar(name, input, { tenant, lead, history, deps }) {
  const actual = () => getLead(deps.db, tenant.id, lead.phone);
  const hayDatos = l => l.nombre || l.necesidad;
  switch (name) {
    case 'registrar_lead':
      updateLead(deps.db, lead.id, input);
      return { ok: true };
    case 'consultar_horarios':
      return { opciones: await opciones(tenant, deps) };
    case 'agendar_llamada': {
      const start = new Date(input.iso);
      if (isNaN(start) || !enHorario(start, deps.now, tenant.horario)) return { error: 'fuera_de_horario', opciones: await opciones(tenant, deps) };
      const end = new Date(start.getTime() + tenant.horario.bloqueMin * 60e3);
      if (!(await isFree(deps.calendar, start, end))) return { error: 'ocupado', opciones: await opciones(tenant, deps) };
      const l = actual();
      await deps.calendar.createEvent({
        start, end, title: `Llamada ${tenant.nombre} — ${l.nombre || l.phone}`,
        description: `Teléfono: ${l.phone}\nNecesidad: ${l.necesidad ?? '—'}\nNegocio: ${l.negocio ?? '—'}\nUrgencia: ${l.urgencia ?? '—'}`,
      });
      updateLead(deps.db, lead.id, { estado: 'agendado', llamada_inicio: start.toISOString() });
      await deps.notifier.notify(tenant, 'lead', actual(), history);
      return { ok: true, agendada: formatSlot(start) };
    }
    case 'cerrar_sin_llamada': {
      updateLead(deps.db, lead.id, { estado: 'cerrado' });
      const l = actual();
      if (hayDatos(l)) await deps.notifier.notify(tenant, 'lead', l, history);
      return { ok: true };
    }
    case 'solicitar_cambio':
      await deps.notifier.notify(tenant, 'cambio', actual(), history, input.detalle);
      return { ok: true };
    case 'marcar_cliente_urgente':
      updateLead(deps.db, lead.id, { es_cliente: 1 });
      await deps.notifier.notify(tenant, 'urgente', actual(), history, input.empresa);
      return { ok: true };
    default:
      return { error: `herramienta desconocida ${name}` };
  }
}

export async function runAgent({ tenant, lead, history, deps }) {
  const messages = history.slice(history.findIndex(m => m.role === 'user')).map(m => ({ role: m.role, content: m.content }));
  const system = buildSystemPrompt(tenant, deps.now);
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const res = await deps.llm.create({ model: MODEL, max_tokens: 2000, output_config: { effort: 'low' }, system, tools: TOOLS, messages });
    if (res.stop_reason === 'refusal') return TEXTO_PRECIO;
    if (res.stop_reason !== 'tool_use') {
      return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || TEXTO_LLAMADA;
    }
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const b of res.content.filter(b => b.type === 'tool_use')) {
      try {
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await ejecutar(b.name, b.input, { tenant, lead, history, deps })) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: e.message });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return TEXTO_LLAMADA;
}
