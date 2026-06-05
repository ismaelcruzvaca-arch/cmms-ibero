-- ============================================================
-- MIGRATION: PDF Server Generation — Storage + History
-- Change: pdf-generation-core (Phase 1)
-- ============================================================
-- Crea el bucket 'generated_pdfs' para almacenar PDFs generados
-- por el servidor vía Edge Function.
--
-- Políticas (storage.objects):
--   INSERT: cualquier usuario autenticado
--   SELECT: solo propietario (owner = auth.uid()) o ADMIN
--   UPDATE: solo propietario
--   DELETE: solo propietario
--
-- Además, extiende report_history con columnas de almacenamiento
-- y referencia al registro origen.
--
-- Idempotente: usa DO $$ con IF NOT EXISTS para el bucket
-- y ADD COLUMN IF NOT EXISTS para las columnas.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Crear bucket generated_pdfs (privado, idempotente)
-- -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'generated_pdfs') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('generated_pdfs', 'generated_pdfs', false);
  END IF;
END $$;

COMMENT ON TABLE storage.buckets IS 'Bucket para PDFs generados por el servidor — privado, acceso por RLS';

-- -----------------------------------------------------------
-- 2. RLS en storage.objects
-- -----------------------------------------------------------
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------
-- 3. INSERT — cualquier usuario autenticado puede subir PDFs
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "generated_pdfs_insert_authenticated" ON storage.objects;
CREATE POLICY "generated_pdfs_insert_authenticated" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'generated_pdfs'
    AND auth.role() = 'authenticated'
  );

-- -----------------------------------------------------------
-- 4. SELECT — solo propietario o ADMIN
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "generated_pdfs_select_owner_admin" ON storage.objects;
CREATE POLICY "generated_pdfs_select_owner_admin" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'generated_pdfs'
    AND (
      owner = auth.uid()
      OR get_user_role() = 'ADMIN'
    )
  );

-- -----------------------------------------------------------
-- 5. UPDATE — solo propietario
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "generated_pdfs_update_owner" ON storage.objects;
CREATE POLICY "generated_pdfs_update_owner" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'generated_pdfs'
    AND owner = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'generated_pdfs'
    AND owner = auth.uid()
  );

-- -----------------------------------------------------------
-- 6. DELETE — solo propietario
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "generated_pdfs_delete_owner" ON storage.objects;
CREATE POLICY "generated_pdfs_delete_owner" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'generated_pdfs'
    AND owner = auth.uid()
  );

-- -----------------------------------------------------------
-- 7. ALTER report_history — columnas de almacenamiento
-- -----------------------------------------------------------
ALTER TABLE report_history
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS record_id UUID,
  ADD COLUMN IF NOT EXISTS record_type TEXT,
  ADD COLUMN IF NOT EXISTS signed_url_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN report_history.storage_path IS
  'Ruta en storage/generated_pdfs del PDF generado (ej: default/ot-default/uuid-20260605T120000Z.pdf)';
COMMENT ON COLUMN report_history.record_id IS
  'UUID del registro origen (ej: work_order.id) que generó este PDF';
COMMENT ON COLUMN report_history.record_type IS
  'Tipo del registro origen (ej: work_order, maintenance_history)';
COMMENT ON COLUMN report_history.signed_url_expires_at IS
  'Timestamp de expiración de la última signed URL generada';

-- -----------------------------------------------------------
-- 8. Índice para consultas por record_id + record_type
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_report_history_record
  ON report_history (record_type, record_id);

-- ============================================================
-- FIN MIGRATION: pdf_server_generation
-- ============================================================
