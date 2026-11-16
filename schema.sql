-- Equipos del parque (catálogo local)
CREATE TABLE IF NOT EXISTS equipos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id    TEXT NOT NULL UNIQUE,
  tipo         TEXT,
  marca        TEXT,
  modelo       TEXT,
  patente      TEXT,
  propietario  TEXT,
  activo       INTEGER DEFAULT 1
);

-- Registro diario por equipo (1 fila = 1 equipo + 1 día)
CREATE TABLE IF NOT EXISTS registro_diario (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id    TEXT NOT NULL,
  fecha        TEXT NOT NULL,
  estado       TEXT DEFAULT 'disponible',
  cliente      TEXT,
  contrato     TEXT,
  comentario   TEXT,
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(equipo_id, fecha)
);

-- Mecánicos (personal técnico)
CREATE TABLE IF NOT EXISTS mecanicos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL,
  rol          TEXT,
  activo       INTEGER DEFAULT 1
);

-- Ubicaciones (faenas/destinos)
CREATE TABLE IF NOT EXISTS ubicaciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL UNIQUE,
  activo       INTEGER DEFAULT 1
);

-- Registro diario por mecánico (1 fila = 1 mecánico + 1 día)
CREATE TABLE IF NOT EXISTS registro_mecanicos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mecanico_id  INTEGER NOT NULL,
  fecha        TEXT NOT NULL,
  estado       TEXT DEFAULT 'descanso',
  ubicacion    TEXT,
  comentario   TEXT,
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(mecanico_id, fecha),
  FOREIGN KEY(mecanico_id) REFERENCES mecanicos(id)
);

-- Insertar ubicaciones iniciales
INSERT OR IGNORE INTO ubicaciones (nombre) VALUES
('Calama'),
('Copiapó'),
('Santiago'),
('Iquique'),
('La Serena');

-- Tipos de mantención y su intervalo en horas (configurable)
CREATE TABLE IF NOT EXISTS tipos_mantencion (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre          TEXT NOT NULL UNIQUE,
  intervalo_horas INTEGER NOT NULL,
  activo          INTEGER DEFAULT 1
);

INSERT OR IGNORE INTO tipos_mantencion (nombre, intervalo_horas) VALUES
('Mantención 250 hrs', 250),
('Mantención 500 hrs', 500),
('Mantención 1000 hrs', 1000);

-- Historial de mantenciones por equipo
CREATE TABLE IF NOT EXISTS mantenciones (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id         TEXT NOT NULL,
  tipo_mantencion   TEXT NOT NULL,
  horometro         REAL NOT NULL,
  fecha             TEXT NOT NULL,
  horometro_proxima REAL,
  origen            TEXT DEFAULT 'manual',
  created_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mant_equipo ON mantenciones(equipo_id, fecha DESC);


-- ── Minutas de operaciones ──────────────────────────────────────────────────
-- Lo conversado en las reuniones del taller (ver minutas.js).
-- Una sola minuta por fecha y tipo.
CREATE TABLE IF NOT EXISTS minutas (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha            TEXT NOT NULL,                 -- día de la reunión (AAAA-MM-DD)
  tipo             TEXT NOT NULL,                 -- diaria | lunes | presentacion
  autor            TEXT,                          -- quien la registra (normalmente Cris)
  asistentes       TEXT,                          -- nombres separados por coma
  trabajos_del_dia TEXT,
  novedades        TEXT,                          -- faena, clientes, personal
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  UNIQUE(fecha, tipo)
);

-- Equipos detenidos según la minuta. equipo_id es el de la tabla equipos.
CREATE TABLE IF NOT EXISTS minuta_detenidos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  minuta_id          INTEGER NOT NULL REFERENCES minutas(id),
  equipo_id          TEXT NOT NULL,
  causa              TEXT NOT NULL,
  desde              TEXT,                        -- desde cuándo está detenido
  estimado_operativo TEXT                         -- cuándo se espera que vuelva a operar
);
CREATE INDEX IF NOT EXISTS idx_minuta_detenidos ON minuta_detenidos(minuta_id);

-- Repuestos pendientes según la minuta
CREATE TABLE IF NOT EXISTS minuta_repuestos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  minuta_id      INTEGER NOT NULL REFERENCES minutas(id),
  equipo_id      TEXT,
  repuesto       TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'por pedir', -- por pedir | pedido | en tránsito | recibido
  fecha_estimada TEXT
);
CREATE INDEX IF NOT EXISTS idx_minuta_repuestos ON minuta_repuestos(minuta_id);

-- Acuerdos de la reunión: texto, responsable y fecha comprometida
CREATE TABLE IF NOT EXISTS minuta_acuerdos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  minuta_id   INTEGER NOT NULL REFERENCES minutas(id),
  texto       TEXT NOT NULL,
  responsable TEXT NOT NULL,
  fecha       TEXT NOT NULL,
  cumplido    INTEGER DEFAULT 0,
  cumplido_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_minuta_acuerdos ON minuta_acuerdos(minuta_id);
