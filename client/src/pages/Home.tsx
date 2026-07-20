import { useEffect, useSyncExternalStore, useState } from 'react';
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
import { getGuestName, subscribeGuestName } from '../store/guest';
import { api, errMsg } from '../api/client';
import { clearAuthenticated } from '../api/session';
import { markGuestSession } from '../api/session';
import { useConfirm } from '../components/ConfirmDialog';
import ThemeToggle from '../components/ThemeToggle';

function BilibiliIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 3 2.5 3M16 3l-2.5 3" />
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="M8 12v2M16 12v2" />
    </svg>
  );
}

export default function Home() {
  const { user, initialized, setUser } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const guestName = useSyncExternalStore(subscribeGuestName, getGuestName, () => '访客');

  useEffect(() => {
    void fetch('/api/health', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { features?: { leaderboard?: boolean } } | null) => {
        if (typeof data?.features?.leaderboard === 'boolean') {
          setShowLeaderboard(data.features.leaderboard);
        }
      })
      .catch(() => undefined);
  }, []);

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
      const { getSocket } = await import('../api/socket');
      getSocket();
      navigate('/');
    } catch (error) {
      setLogoutError(errMsg(error));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="page home-page">
      <div className="header-bar">
        <span className="title">弗一把</span>
        <span className="btns">
          <ThemeToggle />
          {!initialized ? (
            <span className="auth-pending" aria-label="正在恢复登录状态" />
          ) : user ? (
            <>
              <span className="muted">
                {user.username}
                {user.role === 'admin' && ' · 管理员'}
              </span>
              {user.role === 'admin' && (
                <Link className="btn btn-ghost btn-sm" to="/admin" aria-label="管理后台">
                  <Wrench size={15} />
                  <span className="btn-text">管理</span>
                </Link>
              )}
              <button
                className="btn btn-ghost btn-sm"
                aria-label="退出登录"
                onClick={() => void logout()}
                disabled={loggingOut}
              >
                <LogOut size={15} />
                <span className="btn-text">退出</span>
              </button>
            </>
          ) : (
            <>
              <span className="muted">{guestName}</span>
              <Link className="btn btn-sm" to="/login" aria-label="登录或注册">
                <LogIn size={15} />
                <span className="btn-text">登录 / 注册</span>
              </Link>
            </>
          )}
        </span>
      </div>
      {logoutError && <div className="status-bar"><span className="error">{logoutError}</span></div>}
      <main className="page-scroll" id="main-content">
        <div className="home-hero">
          <span className="hero-kicker">CS MAJOR // PLAYER GUESSING</span>
          <h1>弗一把</h1>
          <p className="hero-subtitle">CS:GO / CS2 Major 选手猜测游戏</p>
          {initialized && !user && (
            <p className="muted" style={{ marginTop: 6 }}>
              无需登录即可游玩,战绩保存在本机;登录后自动同步到账号
            </p>
          )}
        </div>
        <div className="menu-grid">
          <MenuCard
            to="/single/easy"
            icon={<Gamepad2 size={22} />}
            label="简单版"
            description="知名选手池 · 快速上手"
            color="#74e38f"
          />
          <MenuCard
            to="/single/normal"
            icon={<Flame size={22} />}
            label="完整版"
            description="完整数据库 · 终极挑战"
            color="#ff6578"
          />
          <MenuCard
            to="/search"
            icon={<Search size={22} />}
            label="查选手"
            description="队伍、国家或地区与 Major 履历"
            color="#65a8ff"
          />
          <MenuCard
            to="/multi"
            icon={<Globe size={22} />}
            label="多人联机"
            description="创建房间或随机匹配"
            color="#ffb64e"
          />
        </div>
        <div className="bottom-bar">
          <Link to="/stats" className="btn">
            <BarChart3 size={15} />
            统计
          </Link>
          {showLeaderboard && (
            <Link to="/leaderboard" className="btn btn-warning">
              <Trophy size={15} />
              排行榜
            </Link>
          )}
          <Link to="/announcement" className="btn btn-success">
            <Megaphone size={15} />
            更新公告
          </Link>
          <a
            href="https://space.bilibili.com/290893104"
            className="btn btn-bilibili"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BilibiliIcon />
            B站:怂皇的一天
          </a>
        </div>
      </main>
    </div>
  );
}
