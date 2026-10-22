# Bot de WhatsApp con IA — HAVOC (motor reutilizable para ATA)

Fecha: 2026-10-22 · Estado: borrador para aprobación

## Intención

HAVOC acaba de publicar su número de WhatsApp (52 452 174 1368) en havocdev.mx.
Quien escriba ahí (pedir informes, una llamada o una cotización) debe recibir
atención inmediata de un asistente con IA que **filtra, junta datos, agenda la
llamada y avisa al dueño**. El cierre (precio, alcance, tiempos) siempre lo hace
una persona en llamada.

El motor se construye **una vez** y sirve para varias empresas: HAVOC es el
primer "tenant"; ATA (servicios de nómina/RH, prospectos → Liliana) entra después
solo con su propia configuración. A futuro es producto vendible a clientes.

## Metas

1. Contestar al instante, 24/7, en español claro con la voz de HAVOC (precisa, sin hype).
2. Entender qué necesita el lead: tipo de proyecto (de los 5 servicios), giro/negocio,
   urgencia, nombre. Su teléfono ya viene del propio WhatsApp.
3. Agendar llamada de 30 min en el **calendario de ventas@havocdev.mx** (Namecheap Private Email, CalDAV) en un hueco libre real.
4. Avisar al dueño:
   - **WhatsApp a su celular personal**: resumen corto (nombre, qué necesita, urgencia, teléfono, hora de llamada si hay).
   - **Correo a ventas@havocdev.mx**: resumen completo + conversación completa (registro de seguimiento).
5. Reconocer **clientes existentes** que piden soporte y avisar como **URGENTE**.
6. Guardar cada lead y conversación en BD (historial independiente del correo).

## No-metas (v1)

- Panel web de leads (el correo + BD bastan; panel se agrega cuando se pida).
- Resolver soporte técnico de clientes (solo avisa).
- Mandar campañas / mensajes masivos.
- Activar ATA en v1: solo debe quedar listo para agregarlo como segundo tenant con configuración, sin cambiar código.
- Conversaciones humanas desde el número del bot: el número es **exclusivo del bot**
  (WhatsApp Cloud API, no queda en la app del celular).

## Anti-metas (si pasa esto, falló aunque funcione)

- **Inventar** datos, servicios, casos o capacidades que no estén en la ficha del tenant.
- **Hablar de dinero**: ningún precio, rango ni "desde $X". Siempre → llamada.
- **Prometer tiempos de entrega.**
- Ofrecer lo que HAVOC no hace (fuera de los 5 servicios) — debe decirlo amablemente.
- Respuestas ilógicas, largas o con exceso de emojis.
- **Mentir si le preguntan si es robot.** Respuesta obligatoria, corta y honesta, p. ej.:
  "Sí, soy el asistente virtual de HAVOC y te atiendo en este primer contacto.
  Si prefieres hablar con una persona, con gusto te agendo una llamada." + horarios.
- Seguirle el juego a conversación ofensiva o fuera de tema: ofrece llamada y corta.

## Comportamiento

### Flujo lead
1. Saludo breve + pregunta abierta de qué necesita.
2. Preguntas mínimas para clasificar (servicio, negocio, urgencia, nombre). No interrogatorio: 3–4 turnos máx.
3. Ante precio / tiempos / alcance → "cada proyecto es a medida; lo vemos en una llamada de 30 min, ¿te agendo?".
4. Agenda: consulta los eventos del calendario de ventas@ (CalDAV), ofrece 2–3 horarios. Lead elige → evento creado
   (título "Llamada HAVOC — {nombre}", descripción con teléfono + resumen). Si no le acomoda ninguno,
   anota su preferencia en texto y el dueño agenda a mano.
5. Cierre: confirma hora; notificaciones salen (WhatsApp + correo).
6. Si el lead no quiere llamada pero dejó datos útiles → igual se notifica como lead "sin llamada".

### Horario de llamadas (defaults, configurables por tenant)
Lunes a viernes 10:00–18:00, America/Mexico_City, bloques de 30 min, mínimo 2 h de anticipación,
ventana de búsqueda 7 días.

### Clientes existentes
- Tabla `clientes` por tenant (nombre empresa + teléfonos) que el dueño llena.
- Número en la tabla → cliente. Número desconocido que dice ser cliente de X → "cliente probable".
- Respuesta: "Ya avisé al equipo, te contactan en breve." No intenta resolver.
- Notificación **URGENTE** (WhatsApp + correo) con el mensaje del cliente.

### Notificaciones WhatsApp al dueño
El bot solo puede escribir libremente dentro de la ventana de 24 h; los avisos al celular personal
usan **plantillas aprobadas por Meta** (`nuevo_lead`, `cliente_urgente`) con variables.

## Restricciones / decisiones tomadas

- Número dedicado, exclusivo del bot, vía **WhatsApp Cloud API (Meta)**. Requiere Meta Business
  Manager, app de Meta, verificación del número y token permanente (system user).
- Webhook necesita **HTTPS válido**: subdominio `bot.havocdev.mx` → 62.238.3.136, cert certbot.
- Servidor Hetzner 62.238.3.136, PM2 + Nginx como el resto de proyectos HAVOC.
- Puerto backend **3017** (ya reservado en el registro para el bot de ATA; pasa a ser el motor compartido).
- Correo saliente vía SMTP Namecheap Private Email (`mail.privateemail.com:465` SSL) desde ventas@havocdev.mx.
- Claude como LLM, temperatura baja, prompt cerrado a la ficha del tenant.
- **Calendario (decisión del usuario):** el de `ventas@havocdev.mx` en Namecheap Private Email, vía
  **CalDAV** (host `mail.privateemail.com`, usuario = correo completo, misma contraseña del buzón).
  Solo ese calendario se revisa para huecos. El evento no invita a nadie (el lead no tiene email).
  Builder: verificar URL CalDAV exacta de Private Email al implementar; la interfaz de calendario va
  detrás de un módulo para que ATA pueda usar Google Calendar (su correo es Google Workspace).
- **Aviso de privacidad (decisión del usuario):** nueva página `havocdev.mx/aviso-privacidad.html` en
  el repo havoc-landing (mismo estilo que el sitio; tomar estructura de `~/ata-landing/aviso-privacidad.html`),
  enlazada en el footer. El borrador del texto lo redacta el builder conforme a la LFPDPPP; **el usuario
  (abogado) lo revisa antes de publicar**. El primer mensaje del bot a cada número incluye el link.
  Retención por defecto: conversaciones 12 meses, luego se borran (configurable por tenant).

## Decisiones del builder (mi propuesta, no confirmadas por el usuario)

- Stack: Node.js + Express (estándar de la casa). BD **SQLite** (volumen bajo, sin contenedor extra;
  precedente autofix). Subir a Postgres si crece.
- Carpeta nueva `~/havoc-bot/`, repo git propio; esta spec se mueve ahí al arrancar.
- Tenant = archivo de configuración (JSON/YAML) por empresa: `phone_number_id` de Meta, ficha de
  servicios/voz, teléfono del dueño, correo de avisos, calendario, horario. El webhook enruta por `phone_number_id`.
- LLM con tool use: herramientas `consultar_horarios`, `agendar_llamada`, `registrar_lead`,
  `marcar_cliente_urgente`. El modelo nunca crea eventos ni avisos sin pasar por esas herramientas.
- Modelo: el Claude vigente más adecuado costo/latencia (confirmar con skill claude-api al implementar).
- Memoria de conversación: últimos N mensajes por número en BD; conversación "cerrada" tras 24 h sin actividad.
- Verificación de firma `X-Hub-Signature-256` del webhook; dedupe por `message.id`.
- Mensajes no-texto (audio, imagen): respuesta fija "por ahora solo leo texto" en v1.

## Llamadas del builder tras la revisión (para que el usuario las revise)

- **Lead a medias:** si la conversación se corta sin llamada, a las 24 h sin actividad un job cierra la
  conversación y, si hay al menos qué necesita o nombre, manda **solo correo** a ventas@ marcado
  "lead incompleto" (sin WhatsApp al dueño, para no gastar plantillas ni hacer ruido).
- **Lead que vuelve a escribir:** mismo número = mismo lead; se actualiza y, si agenda o cambia algo, nuevo aviso.
- **Reagendar / cancelar:** el bot no mueve ni cancela eventos; toma el mensaje y avisa al dueño
  (WhatsApp + correo) para que lo haga él.
- **ATA:** servicios, preguntas de calificación, voz, campos del lead, destinatarios de aviso
  (Liliana), plantillas y horario viven en la **config del tenant**, no en el código. El flujo
  (calificar → agendar → avisar) es el mismo para todos.
- **Lista de clientes:** se llena en la config del tenant (sección `clientes`: empresa + teléfonos)
  y se carga a la BD al arrancar. Sin panel.
- **Número del dueño escribiendo al bot:** se ignora con respuesta fija ("Este es el número del
  asistente; los avisos llegan aquí."). Sin comandos en v1.

## Pendiente del usuario (no bloquea escribir código)

- Crear/usar Meta Business Manager + app WhatsApp, registrar el número 4521741368.
- DNS A `bot` → 62.238.3.136 en Namecheap.
- Contraseña de ventas@havocdev.mx (SMTP + CalDAV).
- Revisar y aprobar el texto del aviso de privacidad.
- Llenar lista de clientes con teléfonos.
- Aprobar textos de las 2 plantillas en Meta.
