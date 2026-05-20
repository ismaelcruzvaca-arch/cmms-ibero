import React, { useState } from 'react';
import { Autocomplete, TextField, Box, Typography, InputAdornment, SvgIcon, IconButton } from '@mui/material';
import { useAssets } from '../lib/rxdb';

function SearchIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </SvgIcon>
  );
}

function CameraIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />
      <path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
    </SvgIcon>
  );
}

export function AssetSearchBar({ onSelectAsset, onOpenScanner }) {
  const { assets, loading } = useAssets();
  const [value, setValue] = useState(null);
  const [inputValue, setInputValue] = useState('');

  // Filtrar activos locales reactivos
  const options = assets || [];

  return (
    <Box sx={{ width: '100%', mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Autocomplete
          id="asset-search-bar"
          options={options}
          loading={loading}
          value={value}
          inputValue={inputValue}
          sx={{ flex: 1 }}
          onInputChange={(event, newInputValue) => {
            setInputValue(newInputValue);
          }}
          onChange={(event, newValue) => {
            setValue(newValue);
            if (newValue) {
              onSelectAsset(newValue);
              // Limpiar la selección de la barra después de disparar el Drawer para permitir búsquedas consecutivas
              setValue(null);
              setInputValue('');
            }
          }}
          getOptionLabel={(option) => `${option.equipment_id} — ${option.description}`}
          filterOptions={(options, state) => {
            const query = state.inputValue.toLowerCase().trim();
            if (!query) return options.slice(0, 100); // Mostrar primeros 100 por defecto si está vacío

            return options.filter(
              (option) =>
                (option.equipment_id && option.equipment_id.toLowerCase().includes(query)) ||
                (option.description && option.description.toLowerCase().includes(query))
            );
          }}
          renderOption={(props, option) => {
            const { key, ...restProps } = props;
            return (
              <Box
                key={option.id}
                component="li"
                {...restProps}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  py: 1,
                  px: 2,
                  borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
                  '&:hover': {
                    backgroundColor: 'rgba(25, 118, 210, 0.08) !important',
                  }
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'primary.main' }}>
                  {option.equipment_id}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                  {option.description || 'Sin descripción'}
                </Typography>
                {option.location && (
                  <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, fontSize: '0.7rem' }}>
                    📍 {option.location}
                  </Typography>
                )}
              </Box>
            );
          }}
          renderInput={(params) => {
            const { InputProps, slotProps, ...otherParams } = params;
            const hasSlotProps = !!slotProps;

            return (
              <TextField
                {...otherParams}
                placeholder="Buscar activo por ID o descripción (Ej: TOS-MOT o Caldera)..."
                variant="outlined"
                {...(hasSlotProps ? {
                  slotProps: {
                    ...slotProps,
                    input: {
                      ...slotProps?.input,
                      startAdornment: (
                        <>
                          <InputAdornment position="start">
                            <SearchIcon color="action" />
                          </InputAdornment>
                          {slotProps?.input?.startAdornment}
                        </>
                      ),
                      type: 'search',
                    }
                  }
                } : {
                  InputProps: {
                    ...InputProps,
                    startAdornment: (
                      <>
                        <InputAdornment position="start">
                          <SearchIcon color="action" />
                        </InputAdornment>
                        {InputProps?.startAdornment}
                      </>
                    ),
                    type: 'search',
                  }
                })}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                  backgroundColor: 'white',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.08)',
                  },
                  '&.Mui-focused': {
                    boxShadow: '0 6px 20px rgba(25, 118, 210, 0.15)',
                  }
                }
              }}
            />
          );
        }}
          noOptionsText="No se encontraron activos"
          loadingText="Cargando base de datos RxDB..."
          fullWidth
        />

        {/* Botón escáner QR — visible en desktop y tablets */}
        <IconButton
          onClick={onOpenScanner}
          aria-label="Escanear código QR"
          size="large"
          sx={{
            mt: 0.5,
            bgcolor: 'primary.main',
            color: 'white',
            width: 48,
            height: 48,
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              bgcolor: 'primary.dark',
              boxShadow: '0 6px 16px rgba(25, 118, 210, 0.4)',
              transform: 'translateY(-1px)',
            },
          }}
        >
          <CameraIcon />
        </IconButton>
      </Box>
    </Box>
  );
}

export default AssetSearchBar;
