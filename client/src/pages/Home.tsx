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
import { api } from '../api/client';
import { closeSocket } from '../api/socket';

export default function Home() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="header-bar">
        <span className="title">弗一把</span>
        <span className="btns">
          {user ? (
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
                onClick={() => {
                  void api.post('/auth/logout').finally(() => {
                    closeSocket();
                    setUser(null);
                  });
                  navigate('/');
                }}
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
      <div className="page-scroll">
        <div className="home-hero">
          <h1>弗一把</h1>
          <p>CS:GO / CS2 Major 选手猜测游戏</p>
          {!user && (
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
