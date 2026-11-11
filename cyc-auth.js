// cyc-auth.js — Acceso compartido con el CYC Hub
// Archivo canónico: se copia idéntico a cyc-tasks y cyc-ops (como cyc-nav.js).
//
// El hub es quien inicia sesión (Google Workspace) y decide a qué áreas entra
// cada persona. Esta app no guarda usuarios ni contraseñas: cuando alguien
// llega sin sesión lo manda al hub, y el hub lo devuelve con un ticket de un
// minuto que acá se canjea por una cookie propia.
//
// Mientras AUTH_ENABLED no sea "true" todo queda abierto, igual que antes:
// se puede desplegar este código sin encender el login.
//
// Variables de entorno:
//   AUTH_ENABLED     "true" para exigir sesión
//   AUTH_JWT_SECRET  el mismo secreto que usa el hub
//   SERVICE_TOKEN    el mismo token de servicio que usa el hub
//   CYC_HUB_URL      dirección del hub (por defecto, la de Railway)
//   CYC_OPS_URL, CYC_TASKS_URL, CYC_INSPECCIONES_URL   direcciones de las otras apps
import crypto from 'crypto';
import { readFileSync } from 'fs';

const limpia = u => String(u || '').replace(/\/$/, '');
export const HUB_URL = limpia(process.env.CYC_HUB_URL || process.env.HUB_URL || 'https://cyc-hub-production.up.railway.app');
const SUITE = {
  hub:   HUB_URL,
  ops:   limpia(process.env.CYC_OPS_URL          || 'https://cyc-ops-production.up.railway.app'),
  tasks: limpia(process.env.CYC_TASKS_URL        || 'https://cyc-tasks-production.up.railway.app'),
  insp:  limpia(process.env.CYC_INSPECCIONES_URL || 'https://cyc-inspecciones-production.up.railway.app'),
};

const COOKIE = 'cyc_sesion';
const HORAS_SESION = 12;
const activo = () => process.env.AUTH_ENABLED === 'true';

// ─── JWT HS256 sin dependencias (compatible con jsonwebtoken del hub) ─────────
const b64u = v => Buffer.from(v).toString('base64url');
function firmar(carga, segundos) {
  const secreto = process.env.AUTH_JWT_SECRET;
  if (!secreto) throw new Error('Falta AUTH_JWT_SECRET');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ ...carga, iat: ahora, exp: ahora + segundos }))}`;
  return `${cuerpo}.${crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}
function verificar(token) {
  const secreto = process.env.AUTH_JWT_SECRET;
  if (!secreto || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    if (JSON.parse(Buffer.from(partes[0], 'base64url')).alg !== 'HS256') return null;
    const esperada = crypto.createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest();
    const recibida = Buffer.from(partes[2], 'base64url');
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
    const carga = JSON.parse(Buffer.from(partes[1], 'base64url'));
    if (!carga.exp || carga.exp < Date.now() / 1000) return null;
    return carga;
  } catch { return null; }
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}
function ponerCookie(req, res, valor, segundos) {
  const seguro = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(valor)}; Max-Age=${segundos}; Path=/; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`);
}

export function tokenDeServicio(req) {
  const esperado = process.env.SERVICE_TOKEN;
  const recibido = req.get('X-Service-Token');
  return Boolean(esperado) && Boolean(recibido) && recibido === esperado;
}

// Para las rutas que solo usa el hub de servidor a servidor: exigen el token
// siempre, también con el login apagado.
export function soloServicio(req, res, next) {
  if (tokenDeServicio(req)) return next();
  res.status(401).json({ ok: false, error: 'Token de servicio inválido' });
}

// ─── Consulta al hub: ¿sigue activa esta persona y qué áreas tiene? ───────────
// Se guarda un minuto. Así, si el administrador le quita un área o desactiva
// la cuenta, el cambio llega acá en un minuto y no cuando expire la cookie.
const cache = new Map(); // token → { hasta, usuario }
async function consultarHub(token, respaldo) {
  const hit = cache.get(token);
  if (hit && hit.hasta > Date.now()) return hit.usuario;
  let usuario;
  try {
    const r = await fetch(`${HUB_URL}/auth/api/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (r.status === 401) usuario = null;
    else if (r.ok) usuario = (await r.json()).usuario;
    else throw new Error(`el hub respondió ${r.status}`);
  } catch (e) {
    // Hub caído: se confía en lo que dice la sesión firmada para no botar la app.
    console.warn('[auth] No se pudo consultar al hub:', e.message);
    return { id: respaldo.uid, email: respaldo.email, nombre: respaldo.nombre, rol: respaldo.rol, areas: respaldo.areas || [], activo: true };
  }
  if (cache.size > 500) cache.clear();
  cache.set(token, { hasta: Date.now() + 60 * 1000, usuario });
  return usuario;
}

// Avisa algo al hub (un evento de tarea, por ejemplo). Nunca frena a quien llama.
export function avisarHub(ruta, cuerpo) {
  if (!process.env.SERVICE_TOKEN) return;
  fetch(`${HUB_URL}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Token': process.env.SERVICE_TOKEN },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(8000),
  }).then(r => { if (!r.ok) console.warn(`[hub] ${ruta} respondió ${r.status}`); })
    .catch(e => console.warn(`[hub] No se pudo avisar a ${ruta}:`, e.message));
}

// Cabeceras para leer el hub de servidor a servidor
export const cabecerasHub = () => (process.env.SERVICE_TOKEN ? { 'X-Service-Token': process.env.SERVICE_TOKEN } : {});

// Ticket de un minuto para abrir otra app de la suite dentro de un iframe
// (Operaciones muestra Inspecciones así) sin pasar por el hub.
export function ticketPara(usuario, app) {
  return firmar({ uid: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol, areas: usuario.areas || [], tipo: 'ticket', app }, 60);
}

/**
 * Instala el acceso en la app. Debe llamarse ANTES de express.static y de las
 * rutas: si va después, los archivos se sirven sin sesión.
 *   app      la app de Express
 *   nombre   'tasks' | 'ops' (como la conoce el hub)
 *   area     área que hay que tener para entrar ('tareas' | 'operaciones')
 *   navJs    ruta al archivo public/cyc-nav.js
 */
export function instalarAcceso(app, { nombre, area, navJs }) {
  app.set('trust proxy', 1);

  // El menú común se sirve con las direcciones de las apps por delante.
  const fuenteNav = readFileSync(navJs, 'utf8');
  app.get('/cyc-nav.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache')
       .send(`window.CYC_SUITE=${JSON.stringify(SUITE)};\n${fuenteNav}`);
  });

  // Vuelta desde el hub con el ticket
  app.get('/auth/callback', (req, res) => {
    const t = verificar(req.query.ticket);
    if (!t || t.tipo !== 'ticket' || t.app !== nombre) return res.redirect(`${HUB_URL}/auth/sso?app=${nombre}`);
    const sesion = firmar({ uid: t.uid, email: t.email, nombre: t.nombre, rol: t.rol, areas: t.areas || [] }, HORAS_SESION * 3600);
    ponerCookie(req, res, sesion, HORAS_SESION * 3600);
    const destino = String(req.query.next || '/');
    res.redirect(destino.startsWith('/') && !destino.startsWith('//') ? destino : '/');
  });

  app.get('/auth/logout', (req, res) => {
    ponerCookie(req, res, '', 0);
    res.redirect(`${HUB_URL}/auth/logout`);
  });

  // Puente hacia el hub para el panel de notificaciones: el navegador habla
  // con esta app y esta app reenvía la sesión al hub.
  app.all('/hub-api/*', async (req, res) => {
    const ruta = req.path.slice('/hub-api'.length);
    if (!ruta.startsWith('/notif/api/') && ruta !== '/auth/api/me') return res.status(404).json({ error: 'Ruta no disponible' });
    const token = leerCookie(req, COOKIE);
    if (!token || !verificar(token)) return res.status(401).json({ autenticado: false });
    try {
      const consulta = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const r = await fetch(`${HUB_URL}${ruta}${consulta}`, {
        method: req.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(15000),
      });
      res.status(r.status).type('application/json').send(await r.text());
    } catch (e) {
      res.status(502).json({ error: 'No se pudo conectar con el hub' });
    }
  });

  // Guardia: desde acá todo pide sesión y el área de esta app.
  app.use(async (req, res, next) => {
    if (!activo()) return next();
    if (tokenDeServicio(req)) { req.esServicio = true; return next(); }

    const esApi = req.path.startsWith('/api/');
    const alHub = () => {
      if (esApi) return res.status(401).json({ ok: false, error: 'Necesitas iniciar sesión' });
      res.redirect(`${HUB_URL}/auth/sso?app=${nombre}&next=${encodeURIComponent(req.originalUrl || '/')}`);
    };

    const token = leerCookie(req, COOKIE);
    const sesion = token && verificar(token);
    if (!sesion || sesion.tipo === 'ticket') return alHub();

    const usuario = await consultarHub(token, sesion);
    if (!usuario || !usuario.activo) { ponerCookie(req, res, '', 0); return alHub(); }
    if (!(usuario.areas || []).includes(area)) {
      if (esApi) return res.status(403).json({ ok: false, error: 'No tienes acceso a esta área' });
      return res.redirect(`${HUB_URL}/auth/sin-acceso?area=${area}`);
    }
    req.usuario = usuario;
    next();
  });
}
