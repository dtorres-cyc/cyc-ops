// minutas.js — Minutas de las reuniones de operaciones
//
// Deja por escrito, el mismo día, lo conversado en las reuniones del taller:
//   diaria        martes a viernes, Cris con el jefe de taller
//   lunes         lunes, con Diego; incluye lo ocurrido el fin de semana
//   presentacion  miércoles y viernes, Cris presenta a Diego
//
// Hay una sola minuta por fecha y tipo. Solo se puede escribir la del día y la
// del día hábil anterior; las más antiguas quedan de solo lectura (los
// acuerdos sí se pueden marcar como cumplidos en cualquier momento).
//
// Las tablas están en schema.sql. Se instala desde server.js con
// instalarMinutas(app, db), después del control de acceso.

const TIPOS = ['diaria', 'lunes', 'presentacion'];
const ESTADOS_REPUESTO = ['por pedir', 'pedido', 'en tránsito', 'recibido'];
const ASISTENTES = ['Diego', 'Cris', 'Héctor', 'Alfredo'];

// ─── Fechas (texto AAAA-MM-DD, día de Chile) ─────────────────────────────────
const hoyChile = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
const esFecha = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diasEntre = (desde, hasta) => Math.round((new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)) / 86400000);
// 1 = lunes … 7 = domingo
const diaSemana = fecha => ((new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
// Día hábil = lunes a viernes. No se consideran feriados.
const esHabil = fecha => diaSemana(fecha) <= 5;
function diaHabilAnterior(fecha) {
  let f = sumarDias(fecha, -1);
  while (!esHabil(f)) f = sumarDias(f, -1);
  return f;
}
// Se puede escribir la minuta de hoy y la del día hábil anterior
function esEditable(fecha, hoy = hoyChile()) {
  return fecha === hoy || fecha === diaHabilAnterior(hoy);
}
const tipoSugerido = fecha => (diaSemana(fecha) === 1 ? 'lunes' : 'diaria');

const texto = v => String(v ?? '').trim();
const fechaONull = v => (esFecha(v) ? v : null);

export function instalarMinutas(app, db) {
  // ─── Lectura ───────────────────────────────────────────────────────────────
  const DETENIDOS_SQL = `
    SELECT d.*, e.tipo AS equipo_tipo, e.marca AS equipo_marca, e.modelo AS equipo_modelo, e.patente AS equipo_patente
    FROM minuta_detenidos d LEFT JOIN equipos e ON e.equipo_id = d.equipo_id
    WHERE d.minuta_id = ? ORDER BY d.id
  `;

  // Desde cuándo está detenido un equipo que figura en una minuta: la fecha
  // «desde» si alguien la anotó; si no, la de la primera minuta consecutiva en
  // que aparece. Las presentaciones sin lista de detenidos no cortan la serie.
  function inicioDetencion(equipoId, fechaMinuta) {
    const serie = db.prepare(`
      SELECT m.fecha, d.id AS detenido, d.desde
      FROM minutas m LEFT JOIN minuta_detenidos d ON d.minuta_id = m.id AND d.equipo_id = ?
      WHERE m.fecha <= ?
        AND (m.tipo != 'presentacion' OR EXISTS (SELECT 1 FROM minuta_detenidos x WHERE x.minuta_id = m.id))
      ORDER BY m.fecha DESC, m.id DESC
    `).all(equipoId, fechaMinuta);
    let inicio = fechaMinuta;
    for (const fila of serie) {
      if (!fila.detenido) break;
      if (fila.desde) return fila.desde;
      inicio = fila.fecha;
    }
    return inicio;
  }

  function minutaCompleta(m, hoy = hoyChile()) {
    if (!m) return null;
    return {
      ...m,
      asistentes: m.asistentes ? m.asistentes.split(',').map(a => a.trim()).filter(Boolean) : [],
      editable: esEditable(m.fecha, hoy),
      detenidos: db.prepare(DETENIDOS_SQL).all(m.id).map(d => {
        const inicio = inicioDetencion(d.equipo_id, m.fecha);
        return { ...d, detenido_desde: inicio, dias_detenido: Math.max(0, diasEntre(inicio, hoy)) };
      }),
      repuestos: db.prepare('SELECT * FROM minuta_repuestos WHERE minuta_id = ? ORDER BY id').all(m.id),
      acuerdos: db.prepare('SELECT * FROM minuta_acuerdos WHERE minuta_id = ? ORDER BY fecha, id').all(m.id)
        .map(a => ({ ...a, vencido: !a.cumplido && a.fecha < hoy })),
    };
  }

  // Lo que la pantalla necesita saber antes de mostrar el formulario
  app.get('/api/minutas/contexto', (req, res) => {
    const hoy = hoyChile();
    res.json({
      hoy, tipo_sugerido: tipoSugerido(hoy), editable_desde: diaHabilAnterior(hoy),
      tipos: TIPOS, estados_repuesto: ESTADOS_REPUESTO, asistentes: ASISTENTES,
      autor: req.usuario?.nombre || null,
    });
  });

  // La minuta de una fecha y tipo, si existe (para abrirla a editar)
  app.get('/api/minutas/una', (req, res) => {
    try {
      const { fecha, tipo } = req.query;
      if (!esFecha(fecha) || !TIPOS.includes(tipo)) return res.status(400).json({ error: 'Fecha o tipo inválido' });
      const m = db.prepare('SELECT * FROM minutas WHERE fecha = ? AND tipo = ?').get(fecha, tipo);
      res.json({ minuta: minutaCompleta(m), editable: esEditable(fecha), tipo_sugerido: tipoSugerido(fecha) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // «Copiar desde la minuta anterior»: detenidos y repuestos de la última
  // minuta que los tenga, sin contar la que se está escribiendo. Los repuestos
  // ya recibidos no se arrastran.
  app.get('/api/minutas/anterior', (req, res) => {
    try {
      const { fecha, tipo } = req.query;
      if (!esFecha(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
      const m = db.prepare(`
        SELECT * FROM minutas m
        WHERE m.fecha <= @fecha AND NOT (m.fecha = @fecha AND m.tipo = @tipo)
          AND (EXISTS (SELECT 1 FROM minuta_detenidos d WHERE d.minuta_id = m.id)
            OR EXISTS (SELECT 1 FROM minuta_repuestos r WHERE r.minuta_id = m.id))
        ORDER BY m.fecha DESC, m.updated_at DESC LIMIT 1
      `).get({ fecha, tipo: tipo || '' });
      if (!m) return res.json({ origen: null, detenidos: [], repuestos: [] });
      const c = minutaCompleta(m);
      res.json({
        origen: { fecha: m.fecha, tipo: m.tipo },
        detenidos: c.detenidos.map(d => ({ equipo_id: d.equipo_id, causa: d.causa, desde: d.detenido_desde, estimado_operativo: d.estimado_operativo })),
        repuestos: c.repuestos.filter(r => r.estado !== 'recibido')
          .map(r => ({ equipo_id: r.equipo_id, repuesto: r.repuesto, estado: r.estado, fecha_estimada: r.fecha_estimada })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Equipos que el calendario de flota tiene detenidos a una fecha. Sirve para
  // partir la primera minuta sin escribir la lista a mano.
  app.get('/api/minutas/sugeridos', (req, res) => {
    try {
      const fecha = esFecha(req.query.fecha) ? req.query.fecha : hoyChile();
      const NOMBRE = { en_taller: 'En taller', fuera_servicio: 'Fuera de servicio (panne)', mantencion: 'Mantención', arrendado_fs: 'Arrendado fuera de servicio' };
      const filas = db.prepare(`
        SELECT e.equipo_id,
          (SELECT r.estado FROM registro_diario r WHERE r.equipo_id = e.equipo_id AND r.fecha <= @fecha ORDER BY r.fecha DESC LIMIT 1) AS estado,
          (SELECT r.comentario FROM registro_diario r WHERE r.equipo_id = e.equipo_id AND r.fecha <= @fecha ORDER BY r.fecha DESC LIMIT 1) AS comentario
        FROM equipos e WHERE e.activo = 1 ORDER BY e.equipo_id
      `).all({ fecha }).filter(f => NOMBRE[f.estado]);
      res.json(filas.map(f => ({ equipo_id: f.equipo_id, causa: texto(f.comentario) || NOMBRE[f.estado], desde: null, estimado_operativo: null })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Guardar ───────────────────────────────────────────────────────────────
  // Crea la minuta de esa fecha y tipo, o la actualiza si ya existe.
  app.put('/api/minutas', (req, res) => {
    try {
      const b = req.body || {};
      const hoy = hoyChile();
      if (!esFecha(b.fecha) || !TIPOS.includes(b.tipo)) return res.status(400).json({ error: 'Falta la fecha o el tipo de reunión' });
      if (b.fecha > hoy) return res.status(400).json({ error: 'No se puede registrar una minuta con fecha futura' });
      if (!esEditable(b.fecha, hoy)) return res.status(403).json({ error: 'Solo se puede editar la minuta de hoy y la del día hábil anterior' });

      const asistentes = (Array.isArray(b.asistentes) ? b.asistentes : []).map(texto).filter(Boolean);
      const detenidos = (Array.isArray(b.detenidos) ? b.detenidos : []).map(d => ({
        equipo_id: texto(d.equipo_id), causa: texto(d.causa), desde: fechaONull(d.desde), estimado: fechaONull(d.estimado_operativo),
      }));
      const repuestos = (Array.isArray(b.repuestos) ? b.repuestos : []).map(r => ({
        equipo_id: texto(r.equipo_id) || null, repuesto: texto(r.repuesto), estado: texto(r.estado) || 'por pedir', fecha: fechaONull(r.fecha_estimada),
      }));
      const acuerdos = (Array.isArray(b.acuerdos) ? b.acuerdos : []).map(a => ({
        id: Number(a.id) || null, texto: texto(a.texto), responsable: texto(a.responsable), fecha: fechaONull(a.fecha),
      }));

      const existeEquipo = db.prepare('SELECT 1 FROM equipos WHERE equipo_id = ?');
      for (const d of detenidos) {
        if (!d.equipo_id || !d.causa) return res.status(400).json({ error: 'Cada equipo detenido necesita el equipo y la causa' });
        if (!existeEquipo.get(d.equipo_id)) return res.status(400).json({ error: `El equipo ${d.equipo_id} no está en la flota` });
      }
      if (new Set(detenidos.map(d => d.equipo_id)).size !== detenidos.length) return res.status(400).json({ error: 'Hay un equipo detenido repetido' });
      for (const r of repuestos) {
        if (!r.repuesto) return res.status(400).json({ error: 'Cada repuesto necesita su descripción' });
        if (!ESTADOS_REPUESTO.includes(r.estado)) return res.status(400).json({ error: 'Estado de repuesto inválido' });
        if (r.equipo_id && !existeEquipo.get(r.equipo_id)) return res.status(400).json({ error: `El equipo ${r.equipo_id} no está en la flota` });
      }
      for (const a of acuerdos) {
        if (!a.texto || !a.responsable || !a.fecha) return res.status(400).json({ error: 'Cada acuerdo necesita texto, responsable y fecha' });
      }

      // Con sesión firma quien está conectado; sin login, lo que diga el formulario
      const autor = req.usuario?.nombre || texto(b.autor) || 'Cris';

      const id = db.transaction(() => {
        let m = db.prepare('SELECT * FROM minutas WHERE fecha = ? AND tipo = ?').get(b.fecha, b.tipo);
        if (m) {
          db.prepare(`UPDATE minutas SET asistentes = ?, trabajos_del_dia = ?, novedades = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(asistentes.join(', '), texto(b.trabajos_del_dia) || null, texto(b.novedades) || null, m.id);
        } else {
          const r = db.prepare('INSERT INTO minutas (fecha, tipo, autor, asistentes, trabajos_del_dia, novedades) VALUES (?, ?, ?, ?, ?, ?)')
            .run(b.fecha, b.tipo, autor, asistentes.join(', '), texto(b.trabajos_del_dia) || null, texto(b.novedades) || null);
          m = { id: r.lastInsertRowid };
        }
        // Detenidos y repuestos se reemplazan completos: son la foto del día
        db.prepare('DELETE FROM minuta_detenidos WHERE minuta_id = ?').run(m.id);
        db.prepare('DELETE FROM minuta_repuestos WHERE minuta_id = ?').run(m.id);
        const insD = db.prepare('INSERT INTO minuta_detenidos (minuta_id, equipo_id, causa, desde, estimado_operativo) VALUES (?, ?, ?, ?, ?)');
        detenidos.forEach(d => insD.run(m.id, d.equipo_id, d.causa, d.desde, d.estimado));
        const insR = db.prepare('INSERT INTO minuta_repuestos (minuta_id, equipo_id, repuesto, estado, fecha_estimada) VALUES (?, ?, ?, ?, ?)');
        repuestos.forEach(r => insR.run(m.id, r.equipo_id, r.repuesto, r.estado, r.fecha));
        // Los acuerdos conservan su id para no perder si ya se cumplieron
        const previos = new Set(db.prepare('SELECT id FROM minuta_acuerdos WHERE minuta_id = ?').all(m.id).map(a => a.id));
        const quedan = new Set();
        for (const a of acuerdos) {
          if (a.id && previos.has(a.id)) {
            db.prepare('UPDATE minuta_acuerdos SET texto = ?, responsable = ?, fecha = ? WHERE id = ?').run(a.texto, a.responsable, a.fecha, a.id);
            quedan.add(a.id);
          } else {
            db.prepare('INSERT INTO minuta_acuerdos (minuta_id, texto, responsable, fecha) VALUES (?, ?, ?, ?)').run(m.id, a.texto, a.responsable, a.fecha);
          }
        }
        for (const idPrevio of previos) if (!quedan.has(idPrevio)) db.prepare('DELETE FROM minuta_acuerdos WHERE id = ?').run(idPrevio);
        return m.id;
      })();

      res.json({ ok: true, minuta: minutaCompleta(db.prepare('SELECT * FROM minutas WHERE id = ?').get(id)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Marcar un acuerdo como cumplido (o deshacerlo). Vale para cualquier minuta.
  app.patch('/api/minutas/acuerdos/:id', (req, res) => {
    try {
      const a = db.prepare('SELECT * FROM minuta_acuerdos WHERE id = ?').get(req.params.id);
      if (!a) return res.status(404).json({ error: 'Acuerdo no encontrado' });
      const cumplido = req.body?.cumplido ? 1 : 0;
      db.prepare('UPDATE minuta_acuerdos SET cumplido = ?, cumplido_en = ? WHERE id = ?').run(cumplido, cumplido ? hoyChile() : null, a.id);
      res.json({ ok: true, id: a.id, cumplido });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Historial ─────────────────────────────────────────────────────────────
  // ?tipo=&equipo=&desde=&hasta=  Por defecto, los últimos 30 días.
  // dias_sin_minuta: días hábiles del rango sin ninguna minuta, contados desde
  // la primera minuta que existe (antes de eso no había dónde escribirlas).
  app.get('/api/minutas', (req, res) => {
    try {
      const hoy = hoyChile();
      const hasta = esFecha(req.query.hasta) ? req.query.hasta : hoy;
      const desde = esFecha(req.query.desde) ? req.query.desde : sumarDias(hasta, -30);
      const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : null;
      const equipo = texto(req.query.equipo);

      let sql = 'SELECT * FROM minutas m WHERE m.fecha BETWEEN ? AND ?';
      const params = [desde, hasta];
      if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
      if (equipo) {
        sql += ` AND (EXISTS (SELECT 1 FROM minuta_detenidos d WHERE d.minuta_id = m.id AND d.equipo_id LIKE ?)
                   OR EXISTS (SELECT 1 FROM minuta_repuestos r WHERE r.minuta_id = m.id AND r.equipo_id LIKE ?))`;
        params.push(`%${equipo}%`, `%${equipo}%`);
      }
      sql += ' ORDER BY m.fecha DESC, m.id DESC';
      const minutas = db.prepare(sql).all(...params).map(m => minutaCompleta(m, hoy));

      const primera = db.prepare('SELECT MIN(fecha) AS f FROM minutas').get().f;
      const conMinuta = new Set(db.prepare('SELECT DISTINCT fecha FROM minutas WHERE fecha BETWEEN ? AND ?').all(desde, hasta).map(f => f.fecha));
      const sinMinuta = [];
      if (primera) {
        // Hoy no cuenta como falta: todavía se puede escribir
        const fin = hasta < hoy ? hasta : sumarDias(hoy, -1);
        for (let f = primera > desde ? primera : desde; f <= fin; f = sumarDias(f, 1)) {
          if (esHabil(f) && !conMinuta.has(f)) sinMinuta.push(f);
        }
      }
      res.json({ desde, hasta, hoy, minutas, dias_sin_minuta: sinMinuta.reverse() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Estado actual ─────────────────────────────────────────────────────────
  // Resumen para Diego: detenidos y repuestos según la última minuta de taller,
  // y todos los acuerdos sin cumplir, vengan de la minuta que vengan.
  app.get('/api/minutas/estado', (_req, res) => {
    try {
      const hoy = hoyChile();
      const ultima = minutaCompleta(db.prepare(`
        SELECT * FROM minutas m
        WHERE m.tipo != 'presentacion'
          OR EXISTS (SELECT 1 FROM minuta_detenidos d WHERE d.minuta_id = m.id)
          OR EXISTS (SELECT 1 FROM minuta_repuestos r WHERE r.minuta_id = m.id)
        ORDER BY m.fecha DESC, m.updated_at DESC, m.id DESC LIMIT 1
      `).get(), hoy);
      const acuerdos = db.prepare(`
        SELECT a.*, m.fecha AS minuta_fecha, m.tipo AS minuta_tipo
        FROM minuta_acuerdos a JOIN minutas m ON m.id = a.minuta_id
        WHERE a.cumplido = 0 ORDER BY a.fecha, a.id
      `).all().map(a => ({ ...a, vencido: a.fecha < hoy }));
      res.json({
        hoy,
        falta_hoy: esHabil(hoy) && !db.prepare('SELECT 1 FROM minutas WHERE fecha = ?').get(hoy),
        ultima: ultima && { id: ultima.id, fecha: ultima.fecha, tipo: ultima.tipo, autor: ultima.autor, asistentes: ultima.asistentes,
          trabajos_del_dia: ultima.trabajos_del_dia, novedades: ultima.novedades },
        detenidos: ultima ? [...ultima.detenidos].sort((a, b) => b.dias_detenido - a.dias_detenido) : [],
        repuestos: ultima ? ultima.repuestos.filter(r => r.estado !== 'recibido').map(r => ({ ...r, atrasado: !!r.fecha_estimada && r.fecha_estimada < hoy })) : [],
        acuerdos,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
