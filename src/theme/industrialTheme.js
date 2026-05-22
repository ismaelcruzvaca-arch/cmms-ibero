import { createTheme } from '@mui/material/styles';

export const industrialTheme = createTheme({
  // 1. Paleta de Alta Legibilidad (Industrial Light Mode)
  palette: {
    mode: 'light',
    background: {
      default: '#F8F9FA', // Gris acero ultra claro para descansar la vista
      paper: '#FFFFFF',
    },
    primary: {
      main: '#0056B3', // Azul Overol (Alta visibilidad, no cansa)
    },
    secondary: {
      main: '#E65100', // Naranja Seguridad — acciones críticas
    },
    text: {
      primary: '#1A1D20', // Gris carbón (Más legible que el negro puro)
      secondary: '#5A5D60',
    },
    divider: '#E0E0E0',
    success: {
      main: '#2E7D32', // Verde Industria
    },
  },

  // 2. Geometría Brutalista
  shape: {
    borderRadius: 4, // Ligeramente redondeado para no cortar, pero industrial
  },

  // 3. Sobreescritura de Componentes (Touch Target y Zero Shadow)
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 48, // Regla del Dedo Gordo
          minWidth: 48,
          textTransform: 'none', // Adiós a las MAYÚSCULAS genéricas de Google
          fontWeight: 600,
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          minHeight: 48,
          minWidth: 48,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: '1px solid #E0E0E0',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid #E0E0E0',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          border: 'none',
          borderLeft: '1px solid #E0E0E0',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: '#E0E0E0',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 48,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
      },
    },
  },
});
