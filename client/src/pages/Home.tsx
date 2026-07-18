import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Gamepad2,
  Flame,
  Globe,
  BarChart3,
  Trophy,
  Megaphone,
  LogIn,
  LogOut,
  Wrench,
} from 'lucide-react';
import MenuCard from '../components/MenuCard';
import { useAuth } from '../store/auth';
import { getGuestName } from '../store/guest';
import { api, errMsg } from '../api/client';
import { clearAuthenticated } from '../api/session';
import { markGuestSession } from '../api/session';
import { useConfirm } from '../components/ConfirmDialog';

export default function Home() {
  const { user, initialized, setUser } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    if (!await confirm({
      title: '退出当前账号?',
      message: '退出后将切换为访客身份，未完成的联机连接会被关闭。',
      confirmLabel: '退出账号',
      tone: 'warning',
    })) return;
    setLogoutError('');
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
      const { closeSocket } = await import('../api/socket');
      closeSocket();
      clearAuthenticated();
      markGuestSession();
      setUser(null);
      navigate('/');
    } catch (error) {
      setLogoutError(errMsg(error));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="page">
      <div className="header-bar">
        <span className="title">弗一把</span>
        <span className="btns">
          {!initialized ? (
            <span className="auth-pending" aria-label="正在恢复登录状态" />
          ) : user ? (
            <>
              <span className="muted">
                {user.username}
                {user.role === 'admin' && ' · 管理员'}
              </span>
              {user.role === 'admin' && (
                <Link className="btn btn-ghost btn-sm" to="/admin">
                  <Wrench size={15} />
                  <span className="btn-text">管理</span>
                </Link>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void logout()}
                disabled={loggingOut}
              >
                <LogOut size={15} />
                <span className="btn-text">退出</span>
              </button>
            </>
          ) : (
            <>
              <span className="muted">{getGuestName()}</span>
              <Link className="btn btn-sm" to="/login">
                <LogIn size={15} />
                登录 / 注册
              </Link>
            </>
          )}
        </span>
      </div>
      {logoutError && <div className="status-bar"><span className="error">{logoutError}</span></div>}
      <div className="page-scroll">
        <div className="home-hero">
          <h1>弗一把</h1>
          <p>CS:GO / CS2 Major 选手猜测游戏</p>
          {initialized && !user && (
            <p className="muted" style={{ marginTop: 6 }}>
              无需登录即可游玩,战绩保存在本机;登录后自动同步到账号
            </p>
          )}
        </div>
        <div className="menu-grid">
          <MenuCard to="/search" icon={<Search size={22} />} label="查选手" color="#2563eb" />
          <MenuCard to="/single/easy" icon={<Gamepad2 size={22} />} label="简单版" color="#16a34a" />
          <MenuCard to="/single/normal" icon={<Flame size={22} />} label="完整版" color="#dc2626" />
          <MenuCard to="/multi" icon={<Globe size={22} />} label="多人联机" color="#d97706" />
        </div>
        <div className="bottom-bar">
          <Link to="/stats" className="btn">
            <BarChart3 size={15} />
            生涯记录
          </Link>
          <Link to="/leaderboard" className="btn btn-warning">
            <Trophy size={15} />
            排行榜
          </Link>
          <Link to="/announcement" className="btn btn-success">
            <Megaphone size={15} />
            更新公告
          </Link>
        </div>
      </div>
    </div>
  );
}
