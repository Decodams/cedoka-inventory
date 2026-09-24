import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { isSupabaseConfigured } from './lib/supabaseClient';
import { ConfigErrorScreen } from './components/ConfigErrorScreen';

// Registers /sw.js so the site can be installed to the home screen as an app
// and keeps working when the connection drops. registerType is 'autoUpdate', so
// a freshly deployed version takes over on the next load.
registerSW({
  immediate: true,
  onOfflineReady() {
    console.info('Cedoka operations platform is ready to work offline.');
  },
  onRegisterError(error) {
    console.error('Service worker registration failed:', error);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured() ? <App /> : <ConfigErrorScreen />}
  </StrictMode>,
);
