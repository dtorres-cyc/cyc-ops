import express from 'express';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 8080;

// ─── Database setup ──────────────────────────────────────────────────────────
const DB_DIR  = process.env.DB_DIR || join(__dirname, 'db');
const DB_PATH = join(DB_DIR, 'cyc-ops.db');

import { mkdirSync } from 'fs';
mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Run schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// GET config for frontend URLs
app.get('/api/config', (req, res) => {
  res.json({
    cycHubUrl: process.env.CYC_HUB_URL || 'https://cyc-hub-production.up.railway.app',
    cycInspeccionesUrl: process.env.CYC_INSPECCIONES_URL || 'https://cyc-inspecciones-production.up.railway.app'
  });
});


// ─── EQUIPOS CRUD ────────────────────────────────────────────────────────────

// GET all equipos
app.get('/api/equipos', (req, res) => {
  try {
    const equipos = db.prepare('SELECT * FROM equipos WHERE activo = 1 ORDER BY equipo_id').all();
    res.json(equipos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add equipo
app.post('/api/equipos', (req, res) => {
  try {
    const { equipo_id, tipo, marca, modelo, patente, propietario } = req.body;
    if (!equipo_id) return res.status(400).json({ error: 'equipo_id requerido' });

    const stmt = db.prepare(`
      INSERT INTO equipos (equipo_id, tipo, marca, modelo, patente, propietario)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(equipo_id) DO UPDATE SET
        tipo = COALESCE(excluded.tipo, tipo),
        marca = COALESCE(excluded.marca, marca),
        modelo = COALESCE(excluded.modelo, modelo),
        patente = COALESCE(excluded.patente, patente),
        propietario = COALESCE(excluded.propietario, propietario),
        activo = 1
    `);
    stmt.run(equipo_id.trim(), tipo || null, marca || null, modelo || null, patente || null, propietario || null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE equipo (soft delete)
app.delete('/api/equipos/:id', (req, res) => {
  try {
    db.prepare('UPDATE equipos SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST sync from cyc-hub
app.post('/api/equipos/sync', async (req, res) => {
  try {
    const HUB_URL = process.env.CYC_HUB_URL || 'https://cyc-hub-production.up.railway.app';
    const response = await fetch(`${HUB_URL}/informe/api/data`);
    if (!response.ok) throw new Error(`Hub responded ${response.status}`);
    const data = await response.json();

    const equipos = data.flota?.equipos || [];
    if (!equipos.length) return res.json({ synced: 0, msg: 'No se encontraron equipos en el Hub' });

    const stmt = db.prepare(`
      INSERT INTO equipos (equipo_id, tipo, patente, propietario)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(equipo_id) DO UPDATE SET
        tipo = COALESCE(excluded.tipo, tipo),
        patente = COALESCE(excluded.patente, patente),
        propietario = COALESCE(excluded.propietario, propietario),
        activo = 1
    `);

    const insertMany = db.transaction((items) => {
      for (const eq of items) {
        if (!eq.id) continue;
        stmt.run(eq.id.trim(), eq.tipo || null, eq.patente || null, eq.propietario || null);
      }
    });

    insertMany(equipos);

    // Also sync active contracts to pre-fill calendar
    let contractsFilled = 0;
    try {
      const ctRes = await fetch(`${HUB_URL}/arriendo/contratos`);
      if (ctRes.ok) {
        const contratos = await ctRes.json();
        const upsertStmt = db.prepare(`
          INSERT INTO registro_diario (equipo_id, fecha, estado, cliente, contrato)
          VALUES (?, ?, 'arrendado', ?, ?)
          ON CONFLICT(equipo_id, fecha) DO NOTHING
        `);

        const today = new Date();
        const fillContracts = db.transaction((cts) => {
          for (const ct of cts) {
            if (!ct.activo) continue;
            const start = new Date(ct.fechaInicio);
            const end = new Date(ct.fechaTermino);
            for (const ce of (ct.contratoEquipos || [])) {
              if (!ce.activo || !ce.equipoId) continue;
              // Fill from max(start, first of current month) to min(end, today)
              const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
              const fillFrom = start > monthStart ? start : monthStart;
              const fillTo = end < today ? end : today;
              const d = new Date(fillFrom);
              while (d <= fillTo) {
                const dateStr = d.toISOString().slice(0, 10);
                upsertStmt.run(ce.equipoId.trim(), dateStr, ct.cliente || '', ct.numeroContrato || '');
                contractsFilled++;
                d.setDate(d.getDate() + 1);
              }
            }
          }
        });
        fillContracts(contratos);
      }
    } catch (syncErr) {
      console.error('[sync] Error syncing contracts:', syncErr.message);
    }

    res.json({ synced: equipos.length, contractsFilled });
  } catch (e) {
    console.error('[sync] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── CALENDARIO / REGISTRO DIARIO ───────────────────────────────────────────

// GET registros de un mes: ?mes=2026-06
app.get('/api/calendario', (req, res) => {
  try {
    const mes = req.query.mes; // "2026-06"
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'Parámetro mes requerido (formato: YYYY-MM)' });
    }
    const registros = db.prepare(`
      SELECT * FROM registro_diario
      WHERE fecha LIKE ? || '%'
      ORDER BY equipo_id, fecha
    `).all(mes);
    res.json(registros);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT upsert a single day
app.put('/api/calendario', (req, res) => {
  try {
    const { equipo_id, fecha, estado, cliente, contrato, comentario } = req.body;
    if (!equipo_id || !fecha) return res.status(400).json({ error: 'equipo_id y fecha requeridos' });

    db.prepare(`
      INSERT INTO registro_diario (equipo_id, fecha, estado, cliente, contrato, comentario, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(equipo_id, fecha) DO UPDATE SET
        estado     = excluded.estado,
        cliente    = excluded.cliente,
        contrato   = excluded.contrato,
        comentario = excluded.comentario,
        updated_at = datetime('now')
    `).run(equipo_id, fecha, estado || 'disponible', cliente || null, contrato || null, comentario || null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT batch update (for drag selection)
app.put('/api/calendario/batch', (req, res) => {
  try {
    const { equipo_id, fechas, estado, cliente, contrato, comentario } = req.body;
    if (!equipo_id || !fechas || !Array.isArray(fechas)) {
      return res.status(400).json({ error: 'equipo_id y fechas[] requeridos' });
    }

    const stmt = db.prepare(`
      INSERT INTO registro_diario (equipo_id, fecha, estado, cliente, contrato, comentario, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(equipo_id, fecha) DO UPDATE SET
        estado     = excluded.estado,
        cliente    = excluded.cliente,
        contrato   = excluded.contrato,
        comentario = excluded.comentario,
        updated_at = datetime('now')
    `);

    const batchUpdate = db.transaction((dates) => {
      for (const f of dates) {
        stmt.run(equipo_id, f, estado || 'disponible', cliente || null, contrato || null, comentario || null);
      }
    });

    batchUpdate(fechas);
    res.json({ ok: true, updated: fechas.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── STATS ───────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes) return res.status(400).json({ error: 'Parámetro mes requerido' });

    const totalEquipos = db.prepare('SELECT COUNT(*) as cnt FROM equipos WHERE activo = 1').get().cnt;

    // Days in month
    const [year, month] = mes.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const totalPossible = totalEquipos * daysInMonth;

    const stats = db.prepare(`
      SELECT
        estado,
        COUNT(*) as cnt
      FROM registro_diario
      WHERE fecha LIKE ? || '%'
      GROUP BY estado
    `).all(mes);

    const byEstado = {};
    let totalRegistros = 0;
    for (const s of stats) {
      byEstado[s.estado] = s.cnt;
      totalRegistros += s.cnt;
    }

    const arrendados = byEstado['arrendado'] || 0;
    const fueraServicio = byEstado['fuera_servicio'] || 0;
    const mantencion = byEstado['mantencion'] || 0;
    const disponible = byEstado['disponible'] || 0;
    const usoInterno = byEstado['uso_interno'] || 0;
    const enTaller = byEstado['en_taller'] || 0;

    const utilizacion = totalPossible > 0 ? Math.round((arrendados / totalPossible) * 100) : 0;

    // Equipment with most FS days
    const topFS = db.prepare(`
      SELECT equipo_id, COUNT(*) as dias
      FROM registro_diario
      WHERE fecha LIKE ? || '%' AND estado IN ('fuera_servicio', 'en_taller')
      GROUP BY equipo_id
      ORDER BY dias DESC
      LIMIT 5
    `).all(mes);

    // Equipment never rented
    const equiposSinArriendo = db.prepare(`
      SELECT e.equipo_id, e.tipo
      FROM equipos e
      WHERE e.activo = 1
        AND e.equipo_id NOT IN (
          SELECT DISTINCT equipo_id FROM registro_diario
          WHERE fecha LIKE ? || '%' AND estado = 'arrendado'
        )
      ORDER BY e.equipo_id
    `).all(mes);

    res.json({
      totalEquipos,
      daysInMonth,
      totalPossible,
      totalRegistros,
      utilizacion,
      byEstado: {
        arrendado: arrendados,
        fuera_servicio: fueraServicio,
        mantencion,
        disponible,
        uso_interno: usoInterno,
        en_taller: enTaller,
      },
      topFueraServicio: topFS,
      equiposSinArriendo: equiposSinArriendo.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy route for contracts from CyC Hub
app.get('/api/contratos', async (req, res) => {
  try {
    const HUB_URL = process.env.CYC_HUB_URL || 'https://cyc-hub-production.up.railway.app';
    const response = await fetch(`${HUB_URL}/arriendo/contratos`);
    if (!response.ok) throw new Error(`Hub responded ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    console.error('Error proxying contracts:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET operations dashboard stats for a month: ?mes=2026-06
app.get('/api/stats/dashboard', (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'Parámetro mes requerido (formato: YYYY-MM)' });
    }

    const [year, month] = mes.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 1. Total active equipment
    const totalEquipos = db.prepare('SELECT COUNT(*) as cnt FROM equipos WHERE activo = 1').get().cnt;
    const totalPossible = totalEquipos * daysInMonth;

    // 2. States breakdown
    const stats = db.prepare(`
      SELECT estado, COUNT(*) as cnt
      FROM registro_diario
      WHERE fecha LIKE ? || '%'
      GROUP BY estado
    `).all(mes);

    const byEstado = {
      arrendado: 0,
      fuera_servicio: 0,
      mantencion: 0,
      disponible: 0,
      uso_interno: 0,
      en_taller: 0
    };
    for (const s of stats) {
      if (s.estado in byEstado) {
        byEstado[s.estado] = s.cnt;
      }
    }

    // 3. Overall utilization rate (%)
    const arrendados = byEstado.arrendado || 0;
    const utilizacion = totalPossible > 0 ? Math.round((arrendados / totalPossible) * 100) : 0;

    // 4. Clients distribution
    const clientesArriendo = db.prepare(`
      SELECT cliente, COUNT(*) as cnt
      FROM registro_diario
      WHERE fecha LIKE ? || '%' AND estado = 'arrendado' AND cliente IS NOT NULL AND cliente != ''
      GROUP BY cliente
      ORDER BY cnt DESC
    `).all(mes);

    // 5. Daily rentals timeline (días-equipo arrendados por fecha)
    const dailyRentals = db.prepare(`
      SELECT SUBSTR(fecha, 9, 2) as dia, COUNT(*) as cnt
      FROM registro_diario
      WHERE fecha LIKE ? || '%' AND estado = 'arrendado'
      GROUP BY fecha
      ORDER BY fecha
    `).all(mes);

    // 6. Downtime detail (días fuera de servicio o taller y comentarios)
    const detenciones = db.prepare(`
      SELECT equipo_id, COUNT(*) as dias, GROUP_CONCAT(COALESCE(comentario, 'Sin comentario'), ' | ') as comentarios
      FROM registro_diario
      WHERE fecha LIKE ? || '%' AND estado IN ('fuera_servicio', 'en_taller')
      GROUP BY equipo_id
      ORDER BY dias DESC
    `).all(mes);

    // 7. Mechanics locations and workload
    const mecanicosUbicaciones = db.prepare(`
      SELECT ubicacion, COUNT(*) as cnt
      FROM registro_mecanicos
      WHERE fecha LIKE ? || '%' AND estado IN ('trabajado', 'extra') AND ubicacion IS NOT NULL AND ubicacion != ''
      GROUP BY ubicacion
      ORDER BY cnt DESC
    `).all(mes);

    // 8. Total active mechanics
    const totalMecanicos = db.prepare('SELECT COUNT(*) as cnt FROM mecanicos WHERE activo = 1').get().cnt;

    res.json({
      totalEquipos,
      daysInMonth,
      totalPossible,
      utilizacion,
      byEstado,
      clientesArriendo,
      dailyRentals,
      detenciones,
      mecanicosUbicaciones,
      totalMecanicos
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── MECÁNICOS CRUD ──────────────────────────────────────────────────────────

// GET all mecanicos
app.get('/api/mecanicos', (req, res) => {
  try {
    const mecanicos = db.prepare('SELECT * FROM mecanicos WHERE activo = 1 ORDER BY nombre').all();
    res.json(mecanicos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add/update mecanico
app.post('/api/mecanicos', (req, res) => {
  try {
    const { id, nombre, rol } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    if (id) {
      const stmt = db.prepare('UPDATE mecanicos SET nombre = ?, rol = ? WHERE id = ?');
      stmt.run(nombre.trim(), rol || null, id);
    } else {
      const stmt = db.prepare('INSERT INTO mecanicos (nombre, rol) VALUES (?, ?)');
      stmt.run(nombre.trim(), rol || null);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE mecanico (soft delete)
app.delete('/api/mecanicos/:id', (req, res) => {
  try {
    db.prepare('UPDATE mecanicos SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── UBICACIONES CRUD ────────────────────────────────────────────────────────

// GET all ubicaciones
app.get('/api/ubicaciones', (req, res) => {
  try {
    const ubicaciones = db.prepare('SELECT * FROM ubicaciones WHERE activo = 1 ORDER BY nombre').all();
    res.json(ubicaciones);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add/update ubicacion
app.post('/api/ubicaciones', (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de ubicación requerido' });

    const stmt = db.prepare(`
      INSERT INTO ubicaciones (nombre) VALUES (?)
      ON CONFLICT(nombre) DO UPDATE SET activo = 1
    `);
    stmt.run(nombre.trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CALENDARIO DE MECÁNICOS ─────────────────────────────────────────────────

// GET registros de un mes: ?mes=2026-06
app.get('/api/calendario/mecanicos', (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'Parámetro mes requerido (formato: YYYY-MM)' });
    }
    const registros = db.prepare(`
      SELECT * FROM registro_mecanicos
      WHERE fecha LIKE ? || '%'
      ORDER BY mecanico_id, fecha
    `).all(mes);
    res.json(registros);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT upsert a single day for a mechanic
app.put('/api/calendario/mecanicos', (req, res) => {
  try {
    const { mecanico_id, fecha, estado, ubicacion, comentario } = req.body;
    if (!mecanico_id || !fecha) return res.status(400).json({ error: 'mecanico_id y fecha requeridos' });

    db.prepare(`
      INSERT INTO registro_mecanicos (mecanico_id, fecha, estado, ubicacion, comentario, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(mecanico_id, fecha) DO UPDATE SET
        estado     = excluded.estado,
        ubicacion  = excluded.ubicacion,
        comentario = excluded.comentario,
        updated_at = datetime('now')
    `).run(mecanico_id, fecha, estado || 'descanso', ubicacion || null, comentario || null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT batch update for mechanics
app.put('/api/calendario/mecanicos/batch', (req, res) => {
  try {
    const { mecanico_id, fechas, estado, ubicacion, comentario } = req.body;
    if (!mecanico_id || !fechas || !Array.isArray(fechas)) {
      return res.status(400).json({ error: 'mecanico_id y fechas[] requeridos' });
    }

    const stmt = db.prepare(`
      INSERT INTO registro_mecanicos (mecanico_id, fecha, estado, ubicacion, comentario, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(mecanico_id, fecha) DO UPDATE SET
        estado     = excluded.estado,
        ubicacion  = excluded.ubicacion,
        comentario = excluded.comentario,
        updated_at = datetime('now')
    `);

    const batchUpdate = db.transaction((dates) => {
      for (const f of dates) {
        stmt.run(mecanico_id, f, estado || 'descanso', ubicacion || null, comentario || null);
      }
    });

    batchUpdate(fechas);
    res.json({ ok: true, updated: fechas.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET stats de mecanicos para un mes: ?mes=2026-06
app.get('/api/stats/mecanicos', (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'Parámetro mes requerido (formato: YYYY-MM)' });
    }

    const totalMecanicos = db.prepare('SELECT COUNT(*) as cnt FROM mecanicos WHERE activo = 1').get().cnt;

    const registros = db.prepare(`
      SELECT r.*, m.nombre, m.rol
      FROM registro_mecanicos r
      JOIN mecanicos m ON r.mecanico_id = m.id
      WHERE r.fecha LIKE ? || '%' AND m.activo = 1
    `).all(mes);

    const byMecanico = {};
    let globalTrabajados = 0;
    let globalExtras = 0;
    let globalViaje = 0;

    for (const r of registros) {
      if (!byMecanico[r.mecanico_id]) {
        byMecanico[r.mecanico_id] = {
          id: r.mecanico_id,
          nombre: r.nombre,
          rol: r.rol,
          trabajados: 0,
          extras: 0,
          viajes: 0,
          descansos: 0,
          licencias: 0,
          vacaciones: 0,
          ubicaciones: {}
        };
      }

      const mStats = byMecanico[r.mecanico_id];
      if (r.estado === 'trabajado') {
        mStats.trabajados++;
        globalTrabajados++;
      } else if (r.estado === 'extra') {
        mStats.extras++;
        globalExtras++;
      } else if (r.estado === 'subida' || r.estado === 'bajada') {
        mStats.viajes++;
        globalViaje++;
      } else if (r.estado === 'descanso') {
        mStats.descansos++;
      } else if (r.estado === 'licencia') {
        mStats.licencias++;
      } else if (r.estado === 'vacaciones') {
        mStats.vacaciones++;
      }

      if (r.ubicacion && (r.estado === 'trabajado' || r.estado === 'extra' || r.estado === 'subida' || r.estado === 'bajada')) {
        mStats.ubicaciones[r.ubicacion] = (mStats.ubicaciones[r.ubicacion] || 0) + 1;
      }
    }

    const listByMecanico = Object.values(byMecanico).map(m => {
      const ubiList = Object.entries(m.ubicaciones)
        .map(([name, count]) => `${name}: ${count}d`)
        .join(', ');
      return {
        ...m,
        ubicacionesStr: ubiList || 'Ninguna'
      };
    });

    const locationsGlobal = {};
    for (const r of registros) {
      if (r.ubicacion && (r.estado === 'trabajado' || r.estado === 'extra')) {
        locationsGlobal[r.ubicacion] = (locationsGlobal[r.ubicacion] || 0) + 1;
      }
    }

    res.json({
      totalMecanicos,
      global: {
        trabajados: globalTrabajados,
        extras: globalExtras,
        viaje: globalViaje
      },
      byMecanico: listByMecanico,
      locationsGlobal
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[cyc-ops] Servidor corriendo en http://0.0.0.0:${PORT}`);
});

