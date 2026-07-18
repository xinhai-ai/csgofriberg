import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './store/auth';
import Home from './pages/Home';
import Login from './pages/Login';
import Search from './pages/Search';
import SingleGame from './pages/SingleGame';
import MultiLobby from './pages/MultiLobby';
import MultiRoom from './pages/MultiRoom';
import Stats from './pages/Stats';
import Leaderboard from './pages/Leaderboard';
import Announcements from './pages/Announcements';
import Admin from './pages/Admin';

/* 所有游戏与数据页面均不强制登录,仅管理后台需要管理员身份 */
function RequireAdmin() {
  const user = useAuth((s) => s.user);
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <Login /> },
  { path: '/search', element: <Search /> },
  { path: '/single/:mode', element: <SingleGame /> },
  { path: '/multi', element: <MultiLobby /> },
  { path: '/multi/room', element: <MultiRoom /> },
  { path: '/stats', element: <Stats /> },
  { path: '/leaderboard', element: <Leaderboard /> },
  { path: '/announcement', element: <Announcements /> },
  {
    element: <RequireAdmin />,
    children: [{ path: '/admin', element: <Admin /> }],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
