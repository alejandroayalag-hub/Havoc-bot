# Bot de WhatsApp con IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot de WhatsApp (Cloud API) con Claude que califica leads de HAVOC, agenda llamada en el calendario CalDAV de ventas@, avisa al dueño por WhatsApp+correo y reconoce clientes urgentes; motor multi-tenant listo para ATA.

**Architecture:** Un servicio Node/Express en puerto 3017. El webhook de Meta enruta por `phone_number_id` a un tenant (JSON en `tenants/`). Cada mensaje pasa por `handler` (dedupe, dueño, cliente, no-texto, aviso de privacidad) y luego por `agent` (Claude + tool use). Estado en SQLite (`node:sqlite`, cero dependencias). Un job cada 15 min cierra conversaciones inactivas y purga datos viejos.

**Tech Stack:** Node ≥22.13 (local 22.22, server 24.14), Express 5, `node:sqlite`, `node:test`, `@anthropic-ai/sdk`, `nodemailer`, `tsdav` (CalDAV), PM2 + Nginx + certbot.

**Spec:** `docs/superpowers/specs/2026-10-22-whatsapp-bot-design.md` (se copia a `~/havoc-bot/docs/` en Task 1).

## Global Constraints

- Carpeta `~/havoc-bot/`, git propio, rama `master`. Puerto backend **3017** (reservado; renombrar la fila del registro a `havoc-bot (motor bot WhatsApp, tenants HAVOC/ATA)`). Sin Postgres ni nginx de puerto propio: Nginx sirve `bot.havocdev.mx:443` → `127.0.0.1:3017`.
- npm no está instalado localmente: usar npm portable en el scratchpad o pedir `sudo apt install npm` al usuario.
- Tests con `node --test` (sin jest). Ningún test llama a Meta, Claude, SMTP ni CalDAV reales: todo vía dependencias inyectadas.
- Zona horaria: America/Mexico_City, que es **UTC−06:00 fijo** (México sin horario de verano desde 2022). `// ponytail: offset fijo -06:00; usar Intl si vuelve el horario de verano`.
- Horario default de llamadas: L–V 10:00–18:00, bloques de 30 min, anticipación mínima 2 h, ventana 7 días, ofrecer 3 opciones.
- El bot **nunca** menciona precios, rangos ni tiempos de entrega; nunca niega ser asistente virtual. Texto obligatorio si preguntan si es robot: "Sí, soy el asistente virtual de HAVOC y te atiendo en este primer contacto. Si prefieres hablar con una persona, con gusto te agendo una llamada."
- Primer mensaje del bot a cada número incluye: `Aviso de privacidad: https://havocdev.mx/aviso-privacidad.html`.
- Mensajes no-texto → "Por ahora solo puedo leer mensajes de texto. ¿Me escribes lo que necesitas?"
- Número del dueño escribiendo → "Este es el número del asistente; los avisos llegan aquí."
- Cliente → "Ya avisé al equipo, te contactan en breve." y aviso URGENTE.
- Secretos solo en `.env` (gitignored): `ANTHROPIC_API_KEY`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, y por tenant `HAVOC_WA_TOKEN`, `HAVOC_MAIL_PASS`. El JSON del tenant referencia el **nombre** de la variable, nunca el valor.
- Modelo: `claude-sonnet-5-5`, `temperature: 0.2`, `max_tokens: 600`. Consultar skill `claude-api` antes de escribir `agent.js`.
- Retención: conversaciones y leads cerrados se borran a los 12 meses (`retencion_meses` por tenant, default 12).

## Review Focus

1. **Meta reenvía el mismo webhook** (reintentos) → se contesta una sola vez. Test en Task 6 (`dedupe`).
2. **Formato de números MX**: Meta manda `521452…` o `52452…`; lista de clientes y número del dueño pueden venir con espacios o `+`. Deben coincidir. Test en Task 2 (`normalizePhone`) y Task 6.
3. **El modelo se le escapa un precio** pese al prompt → filtro de salida reemplaza la respuesta por el texto de "lo vemos en llamada". Test en Task 5 (`guardarrail precio`).
4. **El horario elegido se ocupó** entre oferta y confirmación → `agendar_llamada` re-checa ocupación y devuelve error + nuevos horarios. Test en Task 3/5.
5. **Claude, CalDAV o SMTP caídos** → el webhook responde 200, el lead recibe "Tuvimos un problema técnico; ya avisé al equipo y te contactamos en breve." y el dueño recibe correo de error (best-effort). Test en Task 6.

---

### Task 1: Proyecto, configuración de tenants y BD

**Files:**
- Create: `~/havoc-bot/{package.json,.gitignore,.env.example}`, `src/config.js`, `src/db.js`, `tenants/havoc.json`, `test/config.test.js`, `test/db.test.js`
- Copy: spec y este plan a `~/havoc-bot/docs/superpowers/{specs,plans}/`
- Modify: `~/.claude/projects/-home-alejandroayalag/memory/port_registry.md` (fila 3017)

**Interfaces:**
- Produces:
  - `normalizePhone(s: string) -> string` — solo dígitos; `521XXXXXXXXXX` (13) → `52XXXXXXXXXX`; 10 dígitos → antepone `52`.
  - `loadTenants(dir: string, env = process.env) -> Map<phoneNumberId, Tenant>`; lanza si falta campo o variable de entorno referenciada.
  - `Tenant = { id, nombre, phoneNumberId, waToken, dueno: {telefono, correo}, mail: {host, port, user, pass, from}, calendario: {tipo:'caldav', url, user, pass}, horario: {dias:[1..5], inicio:'10:00', fin:'18:00', bloqueMin:30, anticipacionMin:120, ventanaDias:7, opciones:3}, ficha: {servicios:[{nombre, descripcion}], voz, ubicacion, extras}, preguntas: string[], plantillas: {lead:'nuevo_lead', urgente:'cliente_urgente'}, avisoPrivacidad: url, retencionMeses: 12, clientes: [{empresa, telefonos:[]}] }` (teléfonos ya normalizados; `waToken`/`pass` ya resueltos desde env).
  - `openDb(path) -> DatabaseSync` (crea esquema). Funciones en `db.js`, todas síncronas:
    - `markSeen(db, messageId) -> boolean` (true si era nuevo; `INSERT OR IGNORE`)
    - `getLead(db, tenantId, phone) -> Lead | undefined`, `createLead(db, tenantId, phone) -> Lead`
    - `updateLead(db, id, fields)`; `Lead = {id, tenant_id, phone, nombre, necesidad, negocio, urgencia, estado:'abierto'|'agendado'|'cerrado', es_cliente:0|1, llamada_inicio, aviso_privacidad_enviado:0|1, ultima_actividad, creado}`
    - `addMessage(db, leadId, role:'user'|'assistant', content)`, `recentMessages(db, leadId, n=20) -> [{role, content}]`
    - `syncClientes(db, tenantId, clientes)` (reemplaza todo el tenant), `findCliente(db, tenantId, phone) -> {empresa} | undefined`
    - `inactiveLeads(db, beforeIso) -> Lead[]` (estado `abierto`, `ultima_actividad < beforeIso`)
    - `purge(db, beforeIso) -> number` (borra leads no-abiertos con `ultima_actividad < beforeIso` y sus mensajes)

- [ ] **Step 1:** `git init`, `package.json` (`"type":"module"`, scripts `start: node src/server.js`, `test: node --test`), deps `express @anthropic-ai/sdk nodemailer tsdav`. `.gitignore`: `node_modules .env *.db`.
- [ ] **Step 2: Tests que fallan** — `normalizePhone('+52 452 174 1368') === '524521741368'`, `normalizePhone('5214521741368') === '524521741368'`, `normalizePhone('4521741368') === '524521741368'`; `loadTenants` con fixture lanza si falta `HAVOC_WA_TOKEN`; `markSeen` true y luego false con el mismo id; `createLead`+`getLead` round-trip; `recentMessages` regresa en orden cronológico y respeta `n`; `findCliente` encuentra por teléfono normalizado; `purge` no borra leads `abierto`.
- [ ] **Step 3:** Run `node --test` → FAIL.
- [ ] **Step 4:** Implementar `config.js` y `db.js`. `tenants/havoc.json` con la ficha real: 5 servicios del sitio (apps web a medida, apps móviles, landings/sitios, integraciones pagos/GPS/QR/biométrico, deploy+hosting+mantenimiento de apps propias), voz "precisa, sin hype; mensajes cortos", ubicación Uruapan, Mich. `dueno.telefono` = celular **personal** del dueño (no el 4521741368, que es el del bot): dejar `"PENDIENTE"`; `loadTenants` lanza si es `PENDIENTE` solo con `NODE_ENV=production`. Correo dueño `ventas@havocdev.mx`. `clientes: []`.
- [ ] **Step 5:** `node --test` → PASS. Actualizar registro de puertos. Commit `feat: proyecto, config de tenants y BD`.

### Task 2: Cliente de WhatsApp Cloud API

**Files:** Create `src/whatsapp.js`, `test/whatsapp.test.js`

**Interfaces:**
- Consumes: `Tenant`, `normalizePhone`.
- Produces:
  - `verifySignature(rawBody: Buffer, header: string, appSecret) -> boolean` — HMAC-SHA256, `timingSafeEqual`, header `sha256=<hex>`.
  - `parseWebhook(body) -> [{phoneNumberId, from, id, type, text}]` — aplana `entry[].changes[].value.messages[]`; `from` normalizado; `text` = `text.body` o `null`; ignora `statuses`.
  - `createWhatsApp(fetchFn = fetch) -> { sendText(tenant, to, text), sendTemplate(tenant, to, name, params: string[]) }` — POST `https://graph.facebook.com/v21.0/{phoneNumberId}/messages`, `Bearer waToken`, plantilla en `es_MX`; lanza en status ≥400 con el cuerpo de error.

- [ ] **Step 1: Tests que fallan** — firma válida/inválida/header ausente; `parseWebhook` con payload real de ejemplo (texto, imagen, solo statuses → `[]`); `sendText` llama a la URL correcta con body `{messaging_product:'whatsapp', to, type:'text', text:{body}}` (fetch falso); error 400 lanza.
- [ ] **Step 2:** FAIL → implementar → PASS. Commit `feat: cliente WhatsApp Cloud API`.

### Task 3: Horarios y calendario CalDAV

**Files:** Create `src/horarios.js`, `src/calendar.js`, `test/horarios.test.js`, `test/calendar.test.js`

**Interfaces:**
- Produces:
  - `freeSlots({busy: [{start: Date, end: Date}], now: Date, horario}) -> Date[]` (máx `horario.opciones`; repartir: el primer hueco de cada uno de los primeros días disponibles distintos antes de repetir día).
  - `formatSlot(date) -> string` ej. `"lunes 26 de octubre, 10:30"` (es-MX, hora local −06:00).
  - `createCalendar(cfg, client = tsdav) -> { busy(from: Date, to: Date) -> Promise<[{start,end}]>, createEvent({start, end, title, description}) -> Promise<void> }` — tsdav `createDAVClient` con Basic auth, `fetchCalendars` toma el primero (o el de `cfg.nombre` si existe), `fetchCalendarObjects` con `timeRange`, evento como iCalendar con `UID` aleatorio.
  - `isFree(calendar, start, end) -> Promise<boolean>`.

- [ ] **Step 1: Tests que fallan (horarios)** — con `now` = lunes 2026-10-26 09:00 −06:00 y sin ocupados: primer slot ≥ 11:00 (anticipación 2 h), 3 opciones en días distintos; sábado/domingo nunca; evento ocupado 11:00–12:00 → no ofrece 11:00 ni 11:30; `now` viernes 17:00 → primer slot el lunes; `formatSlot` exacto.
- [ ] **Step 2: Tests que fallan (calendar)** — con cliente tsdav falso: `busy` parsea DTSTART/DTEND de los objetos; `createEvent` manda ICS con `SUMMARY` y `DTSTART:...Z` correctos; `isFree` false si se traslapa.
- [ ] **Step 3:** FAIL → implementar → PASS. Verificar manualmente URL CalDAV de Private Email (probar `https://mail.privateemail.com/caldav/` vía `node -e` con la contraseña real cuando el usuario la dé; si falla, documentar la correcta en `tenants/havoc.json`). Commit `feat: horarios y calendario CalDAV`.

### Task 4: Avisos (correo + plantilla WhatsApp)

**Files:** Create `src/notify.js`, `test/notify.test.js`

**Interfaces:**
- Consumes: `createWhatsApp().sendTemplate`, `Lead`, `Tenant`.
- Produces: `createNotifier({wa, mailer = nodemailer}) -> { notify(tenant, kind, lead, conversacion: [{role,content}], extra?: string) -> Promise<void> }`
  - `kind`: `'lead'` (WhatsApp + correo), `'incompleto'` (solo correo), `'urgente'` (WhatsApp + correo), `'cambio'` (WhatsApp + correo, reagendar/cancelar), `'error'` (solo correo).
  - Asunto correo: `[Lead] {nombre||phone} — {necesidad}`, `[Lead incompleto] …`, `[URGENTE] Cliente {empresa} — {phone}`, `[Cambio de llamada] …`, `[Error bot] …`. Cuerpo texto plano: datos del lead, llamada (si hay, con `formatSlot`), `extra`, y conversación completa.
  - Plantilla `lead` params: `[nombre, necesidad, urgencia, phone, llamada||'sin llamada']`; `urgente` params: `[empresa, phone, ultimoMensaje]`; `cambio` usa plantilla `urgente` con empresa `'Cambio de llamada'`.
  - Un canal fallido no impide el otro; si ambos fallan, lanza.

- [ ] **Step 1: Tests que fallan** — por cada `kind`, qué canales se llaman y con qué asunto/params; WhatsApp falla → correo igual sale y no lanza.
- [ ] **Step 2:** FAIL → implementar → PASS. Commit `feat: avisos por correo y WhatsApp`.

### Task 5: Agente (Claude + herramientas + guardarraíles)

**Files:** Create `src/prompt.js`, `src/agent.js`, `test/agent.test.js`

**Interfaces:**
- Consumes: `freeSlots`, `formatSlot`, `isFree`, calendar, `updateLead`, notifier.
- Produces:
  - `buildSystemPrompt(tenant) -> string` — incluye ficha, preguntas, reglas de Global Constraints (verbatim), "si no está en la ficha, no lo sabes: ofrece la llamada", fecha actual.
  - `runAgent({tenant, lead, history, deps: {llm, calendar, db, notifier, now}}) -> Promise<string>` — loop de tool use (máx 5 vueltas) con `llm.messages.create`. Herramientas:
    - `registrar_lead({nombre?, necesidad?, negocio?, urgencia?})` → `updateLead`.
    - `consultar_horarios({})` → `freeSlots` sobre `calendar.busy(now, now+ventana)`, devuelve lista `{iso, texto}`.
    - `agendar_llamada({iso})` → valida que `iso` caiga en horario; `isFree`; si ocupado → `{error:'ocupado', opciones:[…]}`; si libre → `createEvent` (título `Llamada {tenant.nombre} — {nombre||phone}`, descripción teléfono+necesidad), `updateLead({estado:'agendado', llamada_inicio})`, `notify('lead')`.
    - `cerrar_sin_llamada({})` → `updateLead({estado:'cerrado'})`, `notify('lead')` si hay `necesidad` o `nombre`.
    - `solicitar_cambio({detalle})` → `notify('cambio', …, detalle)`.
  - `guardPrice(text, tenant) -> string` — si `text` contiene `/\$\s?\d|\d+\s?(mil|pesos|mxn|usd|dólares)|\bsemanas?\b.*entrega|entrega.*\bsemanas?\b/i`, devuelve "Cada proyecto es a la medida; costos y tiempos los vemos en una llamada de 30 minutos. ¿Te agendo una?". `// ponytail: regex simple; ampliar con casos reales del log`.

- [ ] **Step 1: Tests que fallan** con `llm` falso que devuelve respuestas guionadas: (a) llama `consultar_horarios` y luego responde texto → texto final; (b) `agendar_llamada` sobre slot ocupado → la tool devuelve `error:'ocupado'` y no se crea evento; (c) `agendar_llamada` libre → evento creado, lead `agendado`, `notify('lead')` llamado una vez; (d) `guardPrice('Una landing cuesta $8,000')` → texto de llamada; `guardPrice('te llamo el lunes')` sin cambios; (e) loop corta a 5 vueltas; (f) `buildSystemPrompt` contiene el texto de robot verbatim y los 5 servicios.
- [ ] **Step 2:** FAIL → implementar (usar skill `claude-api` para la forma exacta de tool use del SDK) → PASS. Commit `feat: agente con Claude y herramientas`.

### Task 6: Handler + servidor + jobs

**Files:** Create `src/handler.js`, `src/server.js`, `src/jobs.js`, `test/handler.test.js`, `test/jobs.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `handleMessage(msg, deps: {tenants, db, wa, notifier, runAgent, now}) -> Promise<void>`. Orden:
    1. tenant por `msg.phoneNumberId` (desconocido → ignora). 2. `markSeen` false → return. 3. `from === tenant.dueno.telefono` → texto fijo del dueño. 4. lead get/create, `ultima_actividad=now`. 5. `type !== 'text'` → texto fijo no-texto. 6. `findCliente` → `es_cliente=1`, texto fijo cliente, `notify('urgente')`, return. 7. `addMessage(user)`, `runAgent`, `guardPrice`, prefijar aviso de privacidad si `aviso_privacidad_enviado=0` (y marcarlo), `addMessage(assistant)`, `sendText`.
    - Cualquier excepción en 6–7 → texto fijo de problema técnico + `notify('error')` best-effort; nunca relanza.
    - Clientes probables (número desconocido que dice ser cliente): lo resuelve el agente con una herramienta `marcar_cliente_urgente({empresa})` → `es_cliente=1`, `notify('urgente')`. Agregar esta herramienta en `agent.js` en este task.
  - `createApp(deps) -> express.Application`: `GET /webhook` (verificación `hub.mode/hub.verify_token/hub.challenge`), `POST /webhook` (raw body → `verifySignature` → 401 si falla; responde 200 **antes** de procesar; procesa con `handleMessage` en segundo plano), `GET /health`.
  - `cerrarInactivos(deps, now)` — `inactiveLeads(db, now−24h)` → `estado='cerrado'`; si tiene `necesidad` o `nombre` y no es cliente → `notify('incompleto')`.
  - `purgar(db, tenants, now)` — `purge` con `now − retencionMeses`.
  - `server.js`: carga `.env` (`process.loadEnvFile()`), `loadTenants('tenants')`, `syncClientes` por tenant, `listen(3017, '127.0.0.1')`, `setInterval` 15 min para ambos jobs.

- [ ] **Step 1: Tests que fallan (handler)** — mismo `msg.id` dos veces → `sendText` una vez; dueño (`5214521…` vs config `52452…`) → texto fijo, no llama al agente; imagen → texto fijo; cliente en lista → texto fijo + `notify('urgente')`, agente no llamado; primer mensaje → respuesta con link del aviso, segundo mensaje sin link; `runAgent` lanza → texto de problema técnico + `notify('error')`, no lanza.
- [ ] **Step 2: Tests que fallan (server)** — con `supertest`-less: levantar `createApp` en puerto 0 y usar `fetch`: GET verify con token correcto devuelve challenge, incorrecto 403; POST con firma inválida 401; válida 200.
- [ ] **Step 3: Tests que fallan (jobs)** — lead abierto con 25 h y `necesidad` → cerrado + `incompleto`; lead sin datos → cerrado sin aviso; lead 13 meses cerrado → purgado.
- [ ] **Step 4:** FAIL → implementar → PASS (`node --test` todo verde). Commit `feat: handler, servidor y jobs`.

### Task 7: Aviso de privacidad en havocdev.mx

**Files:** Create `~/havoc-landing/aviso-privacidad.html`; Modify `~/havoc-landing/index.html` (footer: link "Aviso de privacidad")

- [ ] **Step 1:** Redactar aviso integral LFPDPPP tomando estructura de `~/ata-landing/aviso-privacidad.html`, con estilos de `styles.css` de HAVOC. Responsable: HAVOC — Soluciones Integradas, Uruapan, Mich.; contacto `administracion@havocdev.mx`. Datos: nombre, teléfono, contenido de mensajes de WhatsApp, giro del negocio. Finalidades primarias: atender solicitud, agendar llamada, cotizar. Encargados: Meta (WhatsApp), Anthropic (procesamiento IA), Namecheap (correo). Conservación 12 meses. Derechos ARCO por correo. **Marcar al inicio del archivo `<!-- BORRADOR: requiere revisión del usuario (abogado) -->`.**
- [ ] **Step 2:** Verificar local en navegador/HTML válido; commit en havoc-landing `Aviso de privacidad (borrador)`. **No desplegar** hasta que el usuario lo apruebe.

### Task 8: Despliegue (bloqueado por pendientes del usuario)

**Precondiciones del usuario:** DNS A `bot.havocdev.mx` → 62.238.3.136; app Meta con número 4521741368 registrado, `phone_number_id`, token permanente, app secret; plantillas `nuevo_lead` y `cliente_urgente` aprobadas en `es_MX`; contraseña de ventas@; celular personal del dueño; `ANTHROPIC_API_KEY`; aviso de privacidad aprobado.

- [ ] **Step 1:** Repo GitHub `havoc-bot` (usuario crea repo vacío; push con llave `~/.ssh/github_account_key`).
- [ ] **Step 2:** En servidor (`ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes root@62.238.3.136`): clonar en `/var/www/havoc-bot` desde árbol limpio (nunca rsync de archivos sueltos), `npm ci --omit=dev`, `.env` (**si ya existe, no sobrescribir**), `pm2 start src/server.js --name havoc-bot`, `pm2 save`.
- [ ] **Step 3:** Nginx `bot.havocdev.mx` (puerto 80 → proxy 127.0.0.1:3017), `certbot --nginx -d bot.havocdev.mx`. Verificar `curl https://bot.havocdev.mx/health` → 200.
- [ ] **Step 4:** Desplegar `aviso-privacidad.html` + `index.html` de havoc-landing a `/var/www/havoc-landing`; verificar 200.
- [ ] **Step 5:** En Meta: webhook `https://bot.havocdev.mx/webhook` + verify token, suscribir `messages`. Prueba real: escribir al bot desde otro celular → saludo con link de aviso; pedir llamada → evento en calendario ventas@, WhatsApp al dueño, correo en ventas@. Preguntar precio y "¿eres robot?" → respuestas correctas.
- [ ] **Step 6:** Actualizar memoria (`project_havoc.md`, registro de puertos). Commit final.
