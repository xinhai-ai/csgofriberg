import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { initializeIdentity } from './api/session';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ensurePow } from './api/pow';
import { initializeTheme } from './store/theme';
import ResourceUpdateDialog from './components/ResourceUpdateDialog';
import ToastViewport from './components/Toast';

localStorage.removeItem('token');
localStorage.removeItem('user');
initializeTheme();

const visualViewport = window.visualViewport;
if (visualViewport) {
  const syncVisualViewportHeight = () => {
    document.documentElement.style.setProperty(
      '--visual-viewport-height',
      `${Math.round(visualViewport.height)}px`
    );
  };
  syncVisualViewportHeight();
  visualViewport.addEventListener('resize', syncVisualViewportHeight);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <RouterProvider router={router} />
      <ResourceUpdateDialog />
      <ToastViewport />
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
