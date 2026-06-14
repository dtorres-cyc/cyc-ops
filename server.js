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

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[cyc-ops] Servidor corriendo en http://0.0.0.0:${PORT}`);
});
