-- ============================================================
-- MIGRATION: PDF Template Admin — Storage Bucket + RLS
-- Change: pdf-template-editor (Phase 1)
-- ============================================================
-- Crea el bucket 'branding' para almacenar logos e imágenes
-- de marca de los templates de reporte PDF.
--
-- Políticas:
--   SELECT: todos los usuarios autenticados (lectura pública)
--   INSERT/UPDATE/DELETE: solo PLANNER y ADMIN
--
-- Idempotente: usa DO $$ con IF NOT EXISTS para el bucket
-- y DROP POLICY IF EXISTS para políticas
-- ============================================================

-- -----------------------------------------------------------
-- 1. Crear bucket branding (idempotente)
-- -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'branding') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('branding', 'branding', true);
  END IF;
END $$;

COMMENT ON TABLE storage.buckets IS 'Bucket para assets de branding de templates PDF — logos, imágenes corporativas';

-- -----------------------------------------------------------
-- 2. RLS en storage.objects
--    Aseguramos que RLS esté habilitado (idempotente)
-- -----------------------------------------------------------
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------
-- 3. SELECT — todos los authenticated users pueden leer
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "branding_select_authenticated" ON storage.objects;
CREATE POLICY "branding_select_authenticated" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'branding');

-- -----------------------------------------------------------
-- 4. INSERT — solo PLANNER/ADMIN
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "branding_insert_planner_admin" ON storage.objects;
CREATE POLICY "branding_insert_planner_admin" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'branding'
    AND get_user_role() IN ('PLANNER', 'ADMIN')
  );

-- -----------------------------------------------------------
-- 5. UPDATE — solo PLANNER/ADMIN
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "branding_update_planner_admin" ON storage.objects;
CREATE POLICY "branding_update_planner_admin" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'branding'
    AND get_user_role() IN ('PLANNER', 'ADMIN')
  )
  WITH CHECK (
    bucket_id = 'branding'
    AND get_user_role() IN ('PLANNER', 'ADMIN')
  );

-- -----------------------------------------------------------
-- 6. DELETE — solo PLANNER/ADMIN
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "branding_delete_planner_admin" ON storage.objects;
CREATE POLICY "branding_delete_planner_admin" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'branding'
    AND get_user_role() IN ('PLANNER', 'ADMIN')
  );

-- ============================================================
-- FIN MIGRATION: pdf_template_admin_storage
-- ============================================================
