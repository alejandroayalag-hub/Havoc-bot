import express from 'express';
import { verifySignature, parseWebhook } from './whatsapp.js';

export function createApp({ appSecret, verifyToken, handle }) {
  const app = express();
  // ponytail: cola global en serie; colas por número si el volumen lo pide.
  let cola = Promise.resolve();

  app.get('/health', (req, res) => res.send('ok'));

  app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) return res.send(req.query['hub.challenge']);
    res.sendStatus(403);
  });

  app.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !verifySignature(req.body, req.get('X-Hub-Signature-256'), appSecret)) return res.sendStatus(401);
    res.sendStatus(200);
    let mensajes;
    try { mensajes = parseWebhook(JSON.parse(req.body.toString('utf8'))); } catch (e) { return console.error('webhook JSON:', e.message); }
    for (const m of mensajes) cola = cola.then(() => handle(m)).catch(e => console.error('handle:', e));
  });

  return app;
}
