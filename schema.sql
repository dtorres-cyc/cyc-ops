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

