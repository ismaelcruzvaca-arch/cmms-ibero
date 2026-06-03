-- ============================================
-- Migration: Inventory Management & Epicor ERP Integration
-- Version: 20260521000001
-- Description: Topología de almacén (ISO 14224), catálogo de refacciones,
--              solicitudes logísticas, transacciones de inventario,
--              y perfil de usuario con integración Epicor.
-- ============================================

-- ────────────────────────────────────────────
-- 1. ENUM: transaction_type
-- ────────────────────────────────────────────
CREATE TYPE transaction_type_enum AS ENUM (
  'ISSUE',         -- Consumo con requisición
  'RETURN',        -- Devolución a almacén
  'DIRECT_ISSUE',  -- Consumo directo STK-UKN (sin requisición)
  'RECEIPT'        -- Recepción de compra desde Epicor
);

-- ────────────────────────────────────────────
-- 2. Topología Física (ISO 14224)
-- ────────────────────────────────────────────

-- 2a. Almacenes
CREATE TABLE public.storerooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  site_id UUID,  -- REFERENCES public.sites(id) cuando exista
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.storerooms IS 'Almacenes físicos (ISO 14224 topología de inventario)';
COMMENT ON COLUMN public.storerooms.warehouse_code IS 'Código de almacén (mapea a WarehouseCode en Epicor)';
COMMENT ON COLUMN public.storerooms.site_id IS 'ID de sitio/panta (FK futura a sites)';

-- 2b. Ubicaciones dentro de almacén
CREATE TABLE public.storeroom_bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storeroom_id UUID NOT NULL REFERENCES public.storerooms(id) ON DELETE CASCADE,
  bin_num TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(storeroom_id, bin_num)
);

COMMENT ON TABLE public.storeroom_bins IS 'Ubicaciones físicas dentro de cada almacén';
COMMENT ON COLUMN public.storeroom_bins.bin_num IS 'Número de ubicación (ej: A-01-01)';

CREATE INDEX idx_storeroom_bins_storeroom ON public.storeroom_bins(storeroom_id);

-- ────────────────────────────────────────────
-- 3. Catálogo de Refacciones y BOM de Activos
-- ────────────────────────────────────────────

-- 3a. Catálogo de partes (mapeo directo a PartNum de Epicor)
CREATE TABLE public.spare_parts (
  part_num TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  uom TEXT NOT NULL DEFAULT 'EA',
  track_lots BOOLEAN NOT NULL DEFAULT false,
  track_serial BOOLEAN NOT NULL DEFAULT false
);

COMMENT ON TABLE public.spare_parts IS 'Catálogo de refacciones (PartNum de Epicor como PK natural)';
COMMENT ON COLUMN public.spare_parts.track_lots IS 'Habilitar trazabilidad por lote';
COMMENT ON COLUMN public.spare_parts.track_serial IS 'Habilitar trazabilidad por número de serie';

-- 3b. BOM: qué partes usa cada activo (relación N:N)
CREATE TABLE public.asset_spare_parts (
  asset_id TEXT NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  part_num TEXT NOT NULL REFERENCES public.spare_parts(part_num) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, part_num)
);

COMMENT ON TABLE public.asset_spare_parts IS 'Partes recomendadas / BOM por activo (ISO 14224)';

CREATE INDEX idx_asset_spare_parts_asset ON public.asset_spare_parts(asset_id);
CREATE INDEX idx_asset_spare_parts_part ON public.asset_spare_parts(part_num);

-- ────────────────────────────────────────────
-- 4. Solicitudes Logísticas (Requisiciones)
-- ────────────────────────────────────────────

CREATE TABLE public.material_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  part_num TEXT REFERENCES public.spare_parts(part_num) ON DELETE SET NULL,
  line_desc TEXT NOT NULL,
  is_non_stock BOOLEAN NOT NULL DEFAULT false,
  requested_qty NUMERIC NOT NULL CHECK (requested_qty > 0),
  req_num INT,       -- Número de requisición en Epicor (post-sync)
  req_line INT,      -- Línea de requisición en Epicor (post-sync)
  expense_code TEXT, -- Código de cuenta contable Epicor
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.material_requests IS 'Solicitudes de material (requisiciones) asociadas a OT';
COMMENT ON COLUMN public.material_requests.part_num IS 'NULL si is_non_stock = true';
COMMENT ON COLUMN public.material_requests.line_desc IS 'Descripción del material solicitado (siempre obligatorio)';
COMMENT ON COLUMN public.material_requests.is_non_stock IS 'TRUE = material sin número de parte (Non-Stock Item)';
COMMENT ON COLUMN public.material_requests.req_num IS 'Requisition Number asignado por Epicor';
COMMENT ON COLUMN public.material_requests.req_line IS 'Requisition Line asignado por Epicor';

CREATE INDEX idx_material_requests_wo ON public.material_requests(work_order_id);
CREATE INDEX idx_material_requests_part ON public.material_requests(part_num) WHERE part_num IS NOT NULL;
CREATE INDEX idx_material_requests_non_stock ON public.material_requests(is_non_stock);

-- ────────────────────────────────────────────
-- 5. Transacciones de Inventario
-- ────────────────────────────────────────────

CREATE TABLE public.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type transaction_type_enum NOT NULL,
  part_num TEXT REFERENCES public.spare_parts(part_num) ON DELETE SET NULL,
  qty NUMERIC NOT NULL CHECK (qty != 0),
  storeroom_id UUID REFERENCES public.storerooms(id) ON DELETE SET NULL,
  bin_id UUID REFERENCES public.storeroom_bins(id) ON DELETE SET NULL,
  lot_num TEXT,
  serial_num TEXT,
  reason_code TEXT,
  work_order_id TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_transactions IS 'Bitácora de todas las transacciones de inventario';
COMMENT ON COLUMN public.inventory_transactions.transaction_type IS 'ISSUE=con requisición, RETURN=devolución, DIRECT_ISSUE=STK-UKN, RECEIPT=compra';
COMMENT ON COLUMN public.inventory_transactions.qty IS 'Positivo = entrada, Negativo = salida';
COMMENT ON COLUMN public.inventory_transactions.lot_num IS 'Solo aplica si spare_parts.track_lots = true';
COMMENT ON COLUMN public.inventory_transactions.serial_num IS 'Solo aplica si spare_parts.track_serial = true';
COMMENT ON COLUMN public.inventory_transactions.reason_code IS 'Motivo: AVERIA, PROGRAMADO, EMERGENCIA, etc.';

CREATE INDEX idx_invtx_wo ON public.inventory_transactions(work_order_id);
CREATE INDEX idx_invtx_part ON public.inventory_transactions(part_num) WHERE part_num IS NOT NULL;
CREATE INDEX idx_invtx_type ON public.inventory_transactions(transaction_type);
CREATE INDEX idx_invtx_storeroom ON public.inventory_transactions(storeroom_id);
CREATE INDEX idx_invtx_created ON public.inventory_transactions(created_at DESC);

-- ────────────────────────────────────────────
-- 6. Perfil de Usuario
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'mechanic' CHECK (role IN ('mechanic', 'supervisor', 'planner', 'admin')),
  erp_employee_num TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Si la tabla ya existía de Migration 1, agregamos las columnas nuevas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN full_name TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'erp_employee_num'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN erp_employee_num TEXT UNIQUE;
  END IF;
END;
$$;

COMMENT ON TABLE public.user_profiles IS 'Perfiles extendidos de usuario con mapeo a Epicor';
COMMENT ON COLUMN public.user_profiles.erp_employee_num IS 'EmployeeNum en Epicor ERP (único por empleado)';

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_profiles_updated_at();

-- ────────────────────────────────────────────
-- 7. Enable Row Level Security
-- ────────────────────────────────────────────

ALTER TABLE public.storerooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storeroom_bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Políticas base: solo usuarios autenticados pueden leer
CREATE POLICY "Usuarios autenticados pueden leer storerooms"
  ON public.storerooms FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden leer storeroom_bins"
  ON public.storeroom_bins FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden leer spare_parts"
  ON public.spare_parts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden leer asset_spare_parts"
  ON public.asset_spare_parts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden leer material_requests"
  ON public.material_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar material_requests"
  ON public.material_requests FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Usuarios autenticados pueden leer inventory_transactions"
  ON public.inventory_transactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar inventory_transactions"
  ON public.inventory_transactions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Usuarios pueden leer su propio perfil"
  ON public.user_profiles FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Usuarios pueden actualizar su propio perfil"
  ON public.user_profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
