import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './styles.css';
import { api } from './api/client';
import { useAuth } from './store/auth';
import { ensurePow } from './api/pow';

async function bootstrap() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  await ensurePow();
  await api.post('/auth/session');
  try {
    const response = await api.get('/auth/me');
    useAuth.getState().setUser(response.data.user);
  } catch {
    useAuth.getState().setUser(null);
  } finally {
    useAuth.getState().setInitialized();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
}

void bootstrap();
