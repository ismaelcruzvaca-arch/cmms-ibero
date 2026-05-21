import React from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  Chip,
  Paper,
  Stack,
  SvgIcon
} from '@mui/material';

const CloseIcon = (props) => (
  <SvgIcon {...props}>
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </SvgIcon>
);

const CRITICALITY_COLORS = {
  A: { bg: '#ff1744', color: 'white', label: 'Alta' },
  B: { bg: '#ff9100', color: 'white', label: 'Media' },
  C: { bg: '#00e676', color: 'black', label: 'Baja' }
};

export const AssetDetailsPanel = ({ asset, open, onClose }) => {
  if (!asset) return null;

  const criticality = CRITICALITY_COLORS[asset.criticality] || CRITICALITY_COLORS.C;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: { width: { xs: '100%', sm: 420 }, p: 3, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }
        }
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight="bold" color="primary.main">
          Detalle del Activo
        </Typography>
        <IconButton onClick={onClose} edge="end" aria-label="Cerrar detalles">
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider sx={{ mb: 3 }} />

      <Stack spacing={3}>
        {/* Identificación Principal */}
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1, fontWeight: 'bold' }}>
            ID del Equipo
          </Typography>
          <Typography variant="h4" fontWeight="800" color="primary.dark">
            {asset.equipment_id}
          </Typography>
        </Box>

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1, fontWeight: 'bold' }}>
            Descripción
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.primary', fontSize: '1.05rem', lineHeight: 1.5 }}>
            {asset.description || 'Sin descripción'}
          </Typography>
        </Box>

        {/* Metadatos Rápidos */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label={`Criticidad: ${criticality.label}`}
            sx={{ backgroundColor: criticality.bg, color: criticality.color, fontWeight: 'bold', px: 1 }}
          />
          {asset.location && (
            <Chip label={`📍 ${asset.location}`} variant="outlined" sx={{ fontWeight: 500 }} />
          )}
          {asset.site && (
            <Chip label={`🏢 ${asset.site}`} variant="outlined" sx={{ fontWeight: 500 }} />
          )}
        </Box>

        <Divider />

        {/* Ficha Técnica / Propiedades */}
        <Box>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1.5, color: 'text.secondary' }}>
            Información del Activo
          </Typography>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafafa' }}>
            <Stack spacing={2}>
              {asset.serial_number && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Número de Serie
                  </Typography>
                  <Typography variant="body2" fontWeight="600" color="text.primary">
                    {asset.serial_number}
                  </Typography>
                </Box>
              )}

              {asset.manufacturer && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Fabricante
                  </Typography>
                  <Typography variant="body2" fontWeight="600" color="text.primary">
                    {asset.manufacturer}
                  </Typography>
                </Box>
              )}

              {asset.model_number && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Modelo
                  </Typography>
                  <Typography variant="body2" fontWeight="600" color="text.primary">
                    {asset.model_number}
                  </Typography>
                </Box>
              )}

              {asset.resource_group && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Grupo de Recursos
                  </Typography>
                  <Typography variant="body2" fontWeight="600" color="text.primary">
                    {asset.resource_group}
                  </Typography>
                </Box>
              )}

              {asset.in_service_date && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Fecha de Puesta en Servicio
                  </Typography>
                  <Typography variant="body2" fontWeight="600" color="text.primary">
                    {new Date(asset.in_service_date).toLocaleDateString()}
                  </Typography>
                </Box>
              )}

              {asset.asset_type_id && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Tipo de Activo ID
                  </Typography>
                  <Typography variant="body2" fontWeight="600" color="text.primary">
                    {asset.asset_type_id}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Paper>
        </Box>

        {/* Specs JSON de Epicor (technical_specs) */}
        {asset.technical_specs && Object.keys(asset.technical_specs).length > 0 && (
          <Box>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1.5, color: 'text.secondary' }}>
              Especificaciones Técnicas (Epicor)
            </Typography>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#f4f6f8' }}>
              <Stack spacing={1}>
                {Object.entries(asset.technical_specs).map(([key, val]) => (
                  <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #e0e0e0', pb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 550, textTransform: 'capitalize' }}>
                      {key.replace(/_/g, ' ')}
                    </Typography>
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 600 }}>
                      {String(val)}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Box>
        )}
      </Stack>
    </Drawer>
  );
}

export default AssetDetailsPanel;
