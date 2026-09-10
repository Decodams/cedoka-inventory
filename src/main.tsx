import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { isSupabaseConfigured } from './lib/supabaseClient';
import { ConfigErrorScreen } from './components/ConfigErrorScreen';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured() ? <App /> : <ConfigErrorScreen />}
  </StrictMode>,
);
