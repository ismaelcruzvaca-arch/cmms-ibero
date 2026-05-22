-- ============================================================
-- MIGRATION 0: Bootstrap — Tablas base del sistema
-- ============================================================
-- Crea las tablas que existían antes de las migraciones
-- versionadas: assets, asset_types, asset_hierarchy.
-- ============================================================

-- -----------------------------------------------------------
-- 1. asset_types — Catálogo de tipos de activo
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------
-- 2. assets — Activos del sistema / jerarquía de equipos
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  equipment_id VARCHAR NOT NULL,
  description TEXT,
  asset_type_id TEXT REFERENCES asset_types(id),
  serial_number TEXT,
  status TEXT DEFAULT 'active',
  location VARCHAR(100),
  site TEXT,
  resource_group TEXT,
  criticality VARCHAR(1) CHECK (criticality IN ('A','B','C')),
  manufacturer TEXT,
  model_number TEXT,
  in_service_date TIMESTAMPTZ,
  warranty_expiration TIMESTAMPTZ,
  technical_specs JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at BIGINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_assets_equipment_id ON assets(equipment_id);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type_id ON assets(asset_type_id);

-- -----------------------------------------------------------
-- 3. asset_hierarchy — Relaciones jerárquicas entre activos
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_hierarchy (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  hierarchy_level INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at BIGINT DEFAULT 0,
  UNIQUE(parent_id, child_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_hierarchy_parent ON asset_hierarchy(parent_id);
CREATE INDEX IF NOT EXISTS idx_asset_hierarchy_child ON asset_hierarchy(child_id);
