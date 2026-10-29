import { markSeen, getLead, createLead, updateLead, addMessage, recentMessages, findCliente } from './db.js';
import { guardPrice } from './agent.js';

export const PAUSA_MS = 2000;

export const TEXTOS = {
  dueno: 'Este es el número del asistente; los avisos llegan aquí.',
  noTexto: 'Por ahora solo puedo leer mensajes de texto, ¿me escribes lo que necesitas?',
  cliente: 'Ya le avisé al equipo, te contactan en breve.',
  error: 'Tuvimos un problema técnico, ya le avisé al equipo y te contactamos en breve.',
};

export async function handleMessage(msg, deps) {
  const tenant = deps.tenants.get(msg.phoneNumberId);
  if (!tenant || !markSeen(deps.db, msg.id)) return;
  const now = deps.now();

  if (msg.from === tenant.dueno.telefono) {
    await deps.wa.sendText(tenant, msg.from, TEXTOS.dueno).catch(e => console.error('wa dueño:', e.message));
    return;
  }

  let lead = getLead(deps.db, tenant.id, msg.from) ?? createLead(deps.db, tenant.id, msg.from);
  const reabierto = lead.estado === 'cerrado';
  updateLead(deps.db, lead.id, { ultima_actividad: now.toISOString(), ...(reabierto && { estado: 'abierto' }) });
  addMessage(deps.db, lead.id, 'user', msg.text ?? `[${msg.type}]`);

  async function reply(text) {
    let out = text;
    // El saludo va limpio, como lo escribiría una persona; el aviso va en la segunda respuesta, antes de pedir datos.
    if (!lead.aviso_privacidad_enviado && recentMessages(deps.db, lead.id).some(m => m.role === 'assistant')) {
      out += `\n\nTe dejo nuestro aviso de privacidad: ${tenant.avisoPrivacidad}`;
      updateLead(deps.db, lead.id, { aviso_privacidad_enviado: 1 });
      lead.aviso_privacidad_enviado = 1;
    }
    addMessage(deps.db, lead.id, 'assistant', out);
    // Cada párrafo sale como mensaje aparte, con pausa, como escribe una persona.
    // ponytail: la cola del webhook es global, la pausa retrasa también otros chats; cola por número si hay volumen.
    const sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const partes = out.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    for (const [i, parte] of partes.entries()) {
      if (i) await sleep(PAUSA_MS);
      await deps.wa.sendText(tenant, msg.from, parte);
    }
  }

  try {
    if (msg.type !== 'text' || !msg.text) return await reply(TEXTOS.noTexto);

    const cliente = findCliente(deps.db, tenant.id, msg.from);
    if (cliente) {
      const avisar = !lead.es_cliente || reabierto;
      updateLead(deps.db, lead.id, { es_cliente: 1 });
      await reply(TEXTOS.cliente);
      if (avisar) await deps.notifier.notify(tenant, 'urgente', getLead(deps.db, tenant.id, msg.from), recentMessages(deps.db, lead.id), cliente.empresa);
      return;
    }

    const history = recentMessages(deps.db, lead.id);
    const text = await deps.runAgent({
      tenant, lead: getLead(deps.db, tenant.id, msg.from), history,
      deps: { llm: deps.llm, calendar: deps.calendars.get(tenant.id), db: deps.db, notifier: deps.notifier, now },
    });
    await reply(guardPrice(text));
  } catch (e) {
    console.error(`handler ${tenant.id} ${msg.from}:`, e);
    await reply(TEXTOS.error).catch(err => console.error('wa error:', err.message));
    await deps.notifier.notify(tenant, 'error', getLead(deps.db, tenant.id, msg.from), recentMessages(deps.db, lead.id), e.message)
      .catch(err => console.error('notify error:', err.message));
  }
}
