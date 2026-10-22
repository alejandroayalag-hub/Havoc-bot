import { inactiveLeads, updateLead, recentMessages, purge } from './db.js';

export async function cerrarInactivos({ db, tenants, notifier }, now) {
  const porId = new Map([...tenants.values()].map(t => [t.id, t]));
  for (const lead of inactiveLeads(db, new Date(now.getTime() - 24 * 3600e3).toISOString())) {
    updateLead(db, lead.id, { estado: 'cerrado' });
    const tenant = porId.get(lead.tenant_id);
    if (!tenant || lead.es_cliente || !(lead.nombre || lead.necesidad)) continue;
    await notifier.notify(tenant, 'incompleto', { ...lead, estado: 'cerrado' }, recentMessages(db, lead.id, 50))
      .catch(e => console.error(`incompleto ${lead.id}:`, e.message));
  }
}

export function purgar(db, tenants, now) {
  for (const t of tenants.values()) {
    const limite = new Date(now);
    limite.setUTCMonth(limite.getUTCMonth() - t.retencionMeses);
    purge(db, limite.toISOString(), t.id);
  }
}
