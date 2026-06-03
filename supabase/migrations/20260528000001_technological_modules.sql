-- ============================================================
-- MIGRACIÓN 15: Módulos Tecnológicos
-- Change: competency-engine
-- ============================================================
-- Catálogo de módulos tecnológicos para trazabilidad de
-- competencias. Cada activo se asigna a un módulo, y cada
-- módulo define el dominio de conocimiento del técnico.
-- ============================================================

-- ============================================================
-- SECCIÓN 1: technological_modules — Catálogo de módulos
-- ============================================================

CREATE TABLE IF NOT EXISTS technological_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE technological_modules IS
  'Catálogo de módulos tecnológicos para el motor de competencias. Cada módulo agrupa conocimientos y habilidades de un área técnica específica';
COMMENT ON COLUMN technological_modules.id IS
  'Identificador único del módulo tecnológico';
COMMENT ON COLUMN technological_modules.code IS
  'Código único del módulo (ej: M-PACK, M-ELEC)';
COMMENT ON COLUMN technological_modules.name IS
  'Nombre descriptivo del módulo tecnológico';
COMMENT ON COLUMN technological_modules.description IS
  'Descripción detallada del alcance del módulo';
COMMENT ON COLUMN technological_modules.created_at IS
  'Fecha y hora de creación del registro';
COMMENT ON COLUMN technological_modules.updated_at IS
  'Última modificación del registro';

CREATE INDEX IF NOT EXISTS idx_technological_modules_code ON technological_modules(code);

-- ============================================================
-- SECCIÓN 2: Semilla — 8 módulos tecnológicos
-- ============================================================

INSERT INTO technological_modules (code, name, description) VALUES
  ('M-PACK', 'Empaque', 'Máquinas empacadoras, flow-pack, selladoras'),
  ('M-TRAN', 'Transmisiones', 'Reductores, motores, acoplamientos, bandas'),
  ('M-ELEC', 'Tableros / VFD', 'Tableros eléctricos, variadores de frecuencia, PLC'),
  ('M-REFR', 'Refrigeración', 'Sistemas de frío, compresores, torres de enfriamiento'),
  ('M-VAPO', 'Vapor y Calderas', 'Generadores de vapor, tuberías, válvulas de seguridad'),
  ('M-PUMP', 'Bombeo de Fluidos', 'Bombas lobulares, centrífugas, de engranes'),
  ('M-TÉRM', 'Procesado y Templado', 'Intercambiadores de calor, túneles de templado Cavemill'),
  ('M-INFR', 'Infraestructura / Servicios', 'Aire comprimido, instalaciones generales')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SECCIÓN 3: Agregar module_id a assets
-- ============================================================

ALTER TABLE assets ADD COLUMN IF NOT EXISTS module_id UUID REFERENCES technological_modules(id);

COMMENT ON COLUMN assets.module_id IS
  'Módulo tecnológico asociado al activo para trazabilidad de competencias';

CREATE INDEX IF NOT EXISTS idx_assets_module ON assets(module_id);

-- ============================================================
-- SECCIÓN 4: Trigger updated_at en technological_modules
-- ============================================================

CREATE OR REPLACE FUNCTION set_technological_modules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_technological_modules_updated_at ON technological_modules;

CREATE TRIGGER trg_technological_modules_updated_at
  BEFORE UPDATE ON technological_modules
  FOR EACH ROW
  EXECUTE FUNCTION set_technological_modules_updated_at();

COMMENT ON TRIGGER trg_technological_modules_updated_at ON technological_modules IS
  'Actualiza updated_at automáticamente al modificar el módulo';

-- ============================================================
-- SECCIÓN 5: Row Level Security (RLS)
-- ============================================================
-- Matriz de acceso:
--   TECHNICIAN / PLANNER = SELECT (catálogo de solo lectura)
--   ADMIN                = ALL
-- ============================================================

ALTER TABLE technological_modules ENABLE ROW LEVEL SECURITY;

-- Todos los roles autenticados pueden leer
CREATE POLICY technological_modules_select ON technological_modules
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

-- Solo ADMIN puede insertar/actualizar/eliminar (catálogo semilla)
CREATE POLICY technological_modules_insert ON technological_modules
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY technological_modules_update ON technological_modules
  FOR UPDATE TO authenticated USING (
    get_user_role() = 'ADMIN'
  ) WITH CHECK (
    get_user_role() = 'ADMIN'
  );

CREATE POLICY technological_modules_delete ON technological_modules
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
  );
