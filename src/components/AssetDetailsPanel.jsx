/**
 * AssetDetailsPanel — Panel lateral de detalles de activo
 * 
 * Drawer anclado a la derecha. Renderiza campos base + technical_specs (JSONB)
 * con formato legible. Solo lectura.
 */
import React from 'react';
import {
  Drawer, Box, Typography, Chip, IconButton, Divider,
  Table, TableBody, TableCell, TableRow
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import BuildIcon from '@mui/icons-material/Build';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';

const DRAWER_WIDTH = 420;

// ─── Colores según criticidad y status ────────────────────────────────
const CRIT_COLORS = {
  A: { bg: '#ff1744', color: '#fff' },
  B: { bg: '#ff9100', color: '#fff' },
  C: { bg: '#00e676', color: '#000' }
};

const STATUS_COLORS = {
  Active: { bg: '#e8f5e9', color: '#2e7d32' },
  Inactive: { bg: '#fce4ec', color: '#c62828' }
};

// ─── Humanizar llaves JSONB ───────────────────────────────────────────
function humanizeKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bHp\b/g, 'HP')
    .replace(/\bRpm\b/g, 'RPM')
    .replace(/\bPsi\b/g, 'PSI')
    .replace(/\bBtu\b/g, 'BTU')
    .replace(/\bId\b/g, 'ID');
}

// ─── Formatear valores ────────────────────────────────────────────────
function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}

export default function AssetDetailsPanel({ asset, open, onClose }) {
  if (!asset) return null;

  const critStyle = CRIT_COLORS[asset.criticality] || CRIT_COLORS.C;
  const statusStyle = STATUS_COLORS[asset.status] || STATUS_COLORS.Active;
  const hasSpecs = asset.technical_specs && typeof asset.technical_specs === 'object'
    && Object.keys(asset.technical_specs).length > 0;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          p: 0
        }
      }}
    >
      {/* ─── Header ──────────────────────────────────────────────── */}
      <Box sx={{ p: 3, pb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              Expediente Técnico
            </Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mt: 0.5 }}>
              {asset.equipment_id}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
              {asset.description || 'Sin descripción'}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ mt: 0.5 }}>
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Chips de estado */}
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {asset.criticality && (
            <Chip
              label={`Criticidad: ${asset.criticality}`}
              size="small"
              sx={{ backgroundColor: critStyle.bg, color: critStyle.color, fontWeight: 'bold' }}
            />
          )}
          {asset.status && (
            <Chip
              label={asset.status === 'Active' ? 'Activo' : 'Inactivo'}
              size="small"
              sx={{ backgroundColor: statusStyle.bg, color: statusStyle.color, fontWeight: 'bold' }}
            />
          )}
        </Box>
      </Box>

      <Divider />

      {/* ─── Cuerpo: Datos base ──────────────────────────────────── */}
      <Box sx={{ p: 3, pt: 2 }}>
        <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mb: 2 }}>
          Información General
        </Typography>

        <Table size="small" sx={{ '& td': { border: 'none', py: 1 } }}>
          <TableBody>
            {asset.location && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', width: 100, pl: 0 }}>
                  <LocationOnIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  Ubicación
                </TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.location}</TableCell>
              </TableRow>
            )}
            {asset.asset_type_id && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', width: 100, pl: 0 }}>
                  <BuildIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  Tipo
                </TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.asset_type_id}</TableCell>
              </TableRow>
            )}
            {asset.manufacturer && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>Fabricante</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.manufacturer}</TableCell>
              </TableRow>
            )}
            {asset.model_number && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>Modelo</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.model_number}</TableCell>
              </TableRow>
            )}
            {asset.serial_number && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>N° Serie</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.serial_number}</TableCell>
              </TableRow>
            )}
            {asset.site && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>Planta</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.site}</TableCell>
              </TableRow>
            )}
            {asset.resource_group && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>Grupo</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.resource_group}</TableCell>
              </TableRow>
            )}
            {asset.in_service_date && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>
                  <CalendarTodayIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  En servicio
                </TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.in_service_date}</TableCell>
              </TableRow>
            )}
            {asset.warranty_expiration && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary', pl: 0 }}>Garantía</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{asset.warranty_expiration}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      {/* ─── Sección Dinámica: technical_specs (JSONB) ──────────── */}
      {hasSpecs && (
        <>
          <Divider />
          <Box sx={{ p: 3, pt: 2 }}>
            <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mb: 2 }}>
              Especificaciones Técnicas
            </Typography>

            <Table size="small" sx={{ '& td': { border: 'none', py: 1 } }}>
              <TableBody>
                {Object.entries(asset.technical_specs).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell sx={{ color: 'text.secondary', width: 155, pl: 0, fontWeight: 500 }}>
                      {humanizeKey(key)}
                    </TableCell>
                    <TableCell>{formatValue(value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </>
      )}

      {/* ─── Footer: metadata ───────────────────────────────────── */}
      <Box sx={{ flexGrow: 1 }} />
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.disabled">
          ID: {asset.id} &nbsp;|&nbsp; Creado: {asset.created_at ? new Date(asset.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
        </Typography>
      </Box>
    </Drawer>
  );
}
