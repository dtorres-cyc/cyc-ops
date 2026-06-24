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

