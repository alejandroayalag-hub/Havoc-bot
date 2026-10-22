import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePhone } from './config.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export function verifySignature(rawBody, header, appSecret) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const m of v.messages ?? []) {
        out.push({
          phoneNumberId: String(v.metadata?.phone_number_id),
          from: normalizePhone(m.from),
          id: m.id,
          type: m.type,
          text: m.type === 'text' ? m.text?.body ?? null : null,
        });
      }
    }
  }
  return out;
}

export function createWhatsApp(fetchFn = fetch) {
  async function send(tenant, payload) {
    const res = await fetchFn(`${GRAPH}/${tenant.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenant.waToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
    return res.json();
  }
  return {
    sendText: (tenant, to, text) => send(tenant, { to, type: 'text', text: { body: text } }),
    sendTemplate: (tenant, to, name, params) => send(tenant, {
      to, type: 'template',
      template: {
        name, language: { code: 'es_MX' },
        components: [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p) })) }],
      },
    }),
  };
}
