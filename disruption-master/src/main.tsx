import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {installSessionHeader} from './services/session';
import './index.css';

// Must run before the first API call so the opening /api/auth/me carries the
// session token the edge would otherwise have stripped along with the cookie.
installSessionHeader();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
