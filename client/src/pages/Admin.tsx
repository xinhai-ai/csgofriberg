import { useEffect, useState } from 'react';
import { Gamepad2, Swords, Users, Wrench } from 'lucide-react';
import Page from '../components/Page';
import AdminPlayers from '../components/admin/AdminPlayers';
import AdminAnnouncements from '../components/admin/AdminAnnouncements';
import AdminResourceVersion from '../components/admin/AdminResourceVersion';
import AdminUsers from '../components/admin/AdminUsers';
import { getSocket } from '../api/socket';
import { PresenceStats } from '../types';

type Tab = 'players' | 'users' | 'announcements' | 'resources';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('players');
  const [presence, setPresence] = useState<PresenceStats | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onStats = (stats: PresenceStats) => setPresence(stats);
    const subscribe = () => socket.emit('presence:subscribe');
    socket.on('presence:stats', onStats);
    socket.on('connect', subscribe);
    if (socket.connected) subscribe();
    return () => {
      socket.emit('presence:unsubscribe');
      socket.off('presence:stats', onStats);
      socket.off('connect', subscribe);
    };
  }, []);

  return (
    <Page title="管理后台" icon={<Wrench size={17} />}>
      <section className="presence-grid" aria-label="实时在线统计">
        <div className="presence-item">
          <Users size={20} />
          <span>在线人数</span>
          <strong>{presence?.onlineUsers ?? '-'}</strong>
        </div>
        <div className="presence-item">
          <Swords size={20} />
          <span>多人房间</span>
          <strong>{presence?.multiplayerRooms ?? '-'}</strong>
        </div>
        <div className="presence-item">
          <Gamepad2 size={20} />
          <span>单人游戏</span>
          <strong>{presence?.singleGames ?? '-'}</strong>
        </div>
      </section>
      <div className="admin-tabs">
        <button className={tab === 'players' ? 'btn' : 'btn btn-ghost'} onClick={() => setTab('players')}>
          选手管理
        </button>
        <button className={tab === 'users' ? 'btn' : 'btn btn-ghost'} onClick={() => setTab('users')}>
          用户管理
        </button>
        <button className={tab === 'announcements' ? 'btn' : 'btn btn-ghost'} onClick={() => setTab('announcements')}>
          公告管理
        </button>
        <button className={tab === 'resources' ? 'btn' : 'btn btn-ghost'} onClick={() => setTab('resources')}>
          资源版本
        </button>
      </div>
      {tab === 'players' && <AdminPlayers />}
      {tab === 'users' && <AdminUsers />}
      {tab === 'announcements' && <AdminAnnouncements />}
      {tab === 'resources' && <AdminResourceVersion />}
    </Page>
  );
}
