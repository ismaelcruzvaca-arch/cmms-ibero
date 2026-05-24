# Change Proposal: epicor-outbox-pattern

**Intent**: Implementar Transactional Outbox Pattern para garantizar entrega asegurada (Guaranteed Delivery) en el pipeline CMMS → Epicor.

**Motivación**: Desacoplar el sistema de mantenimiento de la disponibilidad del ERP. Sin outbox, una caída de red o timeout de Epicor pierde solicitudes de material para siempre.

**Alcance**: Crear tabla epicor_outbox, trigger de encolado automático en material_requests, y tests pgTAP de verificación.
