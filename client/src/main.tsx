import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './styles.css';
import { initializeIdentity } from './api/session';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ensurePow } from './api/pow';

localStorage.removeItem('token');
localStorage.removeItem('user');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>
  </React.StrictMode>
);

// Render first. PoW and optional account recovery share the same background single-flight task.
void ensurePow().catch(() => undefined);
void initializeIdentity();

const connectPresence = () => {
  void import('./api/socket').then(({ getSocket }) => getSocket()).catch(() => undefined);
};
const requestIdle = window.requestIdleCallback?.bind(window);
if (requestIdle) {
  requestIdle(connectPresence, { timeout: 2_000 });
} else {
  globalThis.setTimeout(connectPresence, 500);
}
