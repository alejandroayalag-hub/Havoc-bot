import nodemailer from 'nodemailer';
import { formatSlot } from './horarios.js';

const v = x => (x ? String(x) : '—'); // WhatsApp rechaza parámetros vacíos
const quien = l => l.nombre || l.phone;
const llamada = l => (l.llamada_inicio ? formatSlot(new Date(l.llamada_inicio)) : 'sin llamada');
const ultimoDelCliente = conv => [...conv].reverse().find(m => m.role === 'user')?.content;

function asunto(kind, lead, extra) {
  switch (kind) {
    case 'lead': return `[Lead] ${quien(lead)} — ${v(lead.necesidad)}`;
    case 'incompleto': return `[Lead incompleto] ${quien(lead)} — ${v(lead.necesidad)}`;
    case 'urgente': return `[URGENTE] Cliente ${v(extra)} — ${lead.phone}`;
    case 'cambio': return `[Cambio de llamada] ${quien(lead)} — ${lead.phone}`;
    case 'error': return `[Error bot] ${lead.phone}`;
    default: throw new Error(`notify: kind desconocido ${kind}`);
  }
}

function cuerpo(lead, conv, extra) {
  return [
    `Nombre: ${v(lead.nombre)}`, `Teléfono: ${lead.phone}`, `Necesidad: ${v(lead.necesidad)}`,
    `Negocio: ${v(lead.negocio)}`, `Urgencia: ${v(lead.urgencia)}`, `Llamada: ${llamada(lead)}`,
    ...(extra ? ['', `Detalle: ${extra}`] : []),
    '', '--- Conversación ---',
    ...conv.map(m => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content}`),
  ].join('\n');
}

function plantilla(tenant, kind, lead, conv, extra) {
  if (kind === 'lead') return [tenant.plantillas.lead, [quien(lead), lead.necesidad, lead.urgencia, lead.phone, llamada(lead)].map(v)];
  if (kind === 'urgente') return [tenant.plantillas.urgente, [extra, lead.phone, ultimoDelCliente(conv)].map(v)];
  if (kind === 'cambio') return [tenant.plantillas.urgente, ['Cambio de llamada', lead.phone, extra].map(v)];
  return null;
}

export function createNotifier({ wa, mailer = nodemailer }) {
  const transports = new Map();
  const transport = m => {
    const key = `${m.host}|${m.user}`;
    if (!transports.has(key)) transports.set(key, mailer.createTransport({ host: m.host, port: m.port, secure: m.port === 465, auth: { user: m.user, pass: m.pass } }));
    return transports.get(key);
  };

  return {
    async notify(tenant, kind, lead, conv = [], extra) {
      const jobs = [transport(tenant.mail).sendMail({ from: tenant.mail.from, to: tenant.dueno.correo, subject: asunto(kind, lead, extra), text: cuerpo(lead, conv, extra) })];
      const tpl = plantilla(tenant, kind, lead, conv, extra);
      if (tpl && tenant.dueno.telefono !== 'PENDIENTE') jobs.push(wa.sendTemplate(tenant, tenant.dueno.telefono, ...tpl));
      const res = await Promise.allSettled(jobs);
      const fallos = res.filter(r => r.status === 'rejected');
      fallos.forEach(f => console.error(`notify ${kind}:`, f.reason?.message));
      if (fallos.length === res.length) throw new Error(`notify ${kind}: fallaron todos los canales`);
    },
  };
}
