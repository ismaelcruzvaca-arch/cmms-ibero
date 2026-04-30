-- ============================================================
-- TRIGGER PARA ACTUALIZAR _last_modified EN WORK ORDERS
-- ============================================================
-- Ejecutar este script en el SQL Editor de Supabase
-- Copiar y pegar todo el bloque siguiente
-- ============================================================

-- 1. Crear la función trigger
CREATE OR REPLACE FUNCTION update_last_modified()
RETURNS TRIGGER AS $$
BEGIN
  -- Multiplicar por 1000 para convertir segundos a milisegundos (JS compatible)
  NEW._last_modified := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Crear el trigger en la tabla work_orders
DROP TRIGGER IF EXISTS work_orders_modified ON work_orders;

CREATE TRIGGER work_orders_modified
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_last_modified();

-- 3. Agregar columna _last_modified si no existe
ALTER TABLE work_orders 
ADD COLUMN IF NOT EXISTS _last_modified BIGINT DEFAULT 0;

-- 4. Agregar columna _deleted si no existe (para soft deletes)
ALTER TABLE work_orders 
ADD COLUMN IF NOT EXISTS _deleted BOOLEAN DEFAULT FALSE;

-- 5. Actualizar registros existentes con timestamp actual
UPDATE work_orders 
SET _last_modified = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE _last_modified = 0;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'work_orders' 
  AND column_name IN ('_last_modified', '_deleted');

-- Probar el trigger
INSERT INTO work_orders (id, equipment_id, description, status)
VALUES ('TEST-001', 'EQ-001', 'Prueba de trigger', 'pending')
RETURNING id, _last_modified;

-- ============================================================
-- NOTA: Si la tabla 'work_orders' no existe, crearla:
-- ============================================================
/*
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  description TEXT,
  location VARCHAR(100),
  criticality VARCHAR(1) CHECK (criticality IN ('A','B','C')),
  status VARCHAR(20) DEFAULT 'pending',
  priority VARCHAR(20),
  assigned_to TEXT,
  scheduled_date TIMESTAMP,
  completed_date TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  _deleted BOOLEAN DEFAULT FALSE,
  _last_modified BIGINT DEFAULT 0
);
*/