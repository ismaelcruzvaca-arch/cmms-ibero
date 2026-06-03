-- ============================================================
-- MIGRATION 12: Epicor Outbox — Transactional Outbox Pattern
-- Change: epicor-outbox-pattern
-- ============================================================
-- Tabla de cola para Guaranteed Delivery CMMS → Epicor.
-- El sistema nunca habla directamente con el ERP.
-- Los triggers inyectan eventos aquí; un adaptador futuro
-- los procesa y envía según el protocolo disponible (REST/SOAP/middleware).
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla epicor_outbox
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS epicor_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT epicor_outbox_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED'))
);

COMMENT ON TABLE epicor_outbox IS
  'Cola de salida para eventos pendientes de enviar a Epicor (Transactional Outbox Pattern)';
COMMENT ON COLUMN epicor_outbox.event_type IS 'Tipo de evento: MATERIAL_REQUEST_CREATE, WORK_ORDER_UPDATE, etc.';
COMMENT ON COLUMN epicor_outbox.payload IS 'Datos del evento en JSONB (desacoplado del protocolo de salida)';
COMMENT ON COLUMN epicor_outbox.status IS 'Estado: PENDING → PROCESSING → SENT | FAILED';
COMMENT ON COLUMN epicor_outbox.next_retry_at IS 'Backoff exponencial: próxima ventana de reintento';
COMMENT ON COLUMN epicor_outbox.last_error IS 'Último error devuelto por Epicor para debugging';

-- -----------------------------------------------------------
-- 2. Índice de polling para el adaptador
--    WHERE status = 'PENDING' AND next_retry_at <= NOW()
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_epicor_outbox_poll
  ON epicor_outbox (status, next_retry_at);

-- -----------------------------------------------------------
-- 3. Función trigger: enqueue_material_request
--    Encola automáticamente cuando se crea una solicitud de material
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_material_request()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO epicor_outbox (event_type, payload)
  VALUES (
    'MATERIAL_REQUEST_CREATE',
    jsonb_build_object(
      'material_request_id', NEW.id,
      'work_order_id', NEW.work_order_id,
      'part_num', NEW.part_num,
      'requested_qty', NEW.requested_qty,
      'line_desc', NEW.line_desc
    )
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enqueue_material_request IS
  'Trigger: captura INSERT en material_requests y lo encola en epicor_outbox';

-- -----------------------------------------------------------
-- 4. Adjuntar trigger a material_requests
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enqueue_material_request ON material_requests;

CREATE TRIGGER trg_enqueue_material_request
  AFTER INSERT ON material_requests
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_material_request();

COMMENT ON TRIGGER trg_enqueue_material_request ON material_requests IS
  'Encola automáticamente toda solicitud de material en epicor_outbox';
