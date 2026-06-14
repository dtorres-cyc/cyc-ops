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
