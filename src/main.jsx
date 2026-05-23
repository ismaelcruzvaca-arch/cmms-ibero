import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import * as Sentry from "@sentry/react";
import { industrialTheme } from './theme/industrialTheme.js';
import './index.css'
import App from './App.jsx'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: true,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration()
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0
});
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={industrialTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)