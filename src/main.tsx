import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { isSupabaseConfigured } from './lib/supabaseClient';
import { ConfigErrorScreen } from './components/ConfigErrorScreen';
import logo from './logo.jpeg';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
favicon.rel = 'icon';
favicon.href = logo;
document.head.appendChild(favicon);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured() ? <App /> : <ConfigErrorScreen />}
  </StrictMode>,
);
