import { useState } from 'react';
import { Wrench } from 'lucide-react';
import Page from '../components/Page';
import AdminPlayers from '../components/admin/AdminPlayers';
import AdminAnnouncements from '../components/admin/AdminAnnouncements';

type Tab = 'players' | 'announcements';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('players');

  return (
    <Page title="管理后台" icon={<Wrench size={17} />}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={tab === 'players' ? 'btn' : 'btn btn-ghost'} onClick={() => setTab('players')}>
          选手管理
        </button>
        <button className={tab === 'announcements' ? 'btn' : 'btn btn-ghost'} onClick={() => setTab('announcements')}>
          公告管理
        </button>
      </div>
      {tab === 'players' ? <AdminPlayers /> : <AdminAnnouncements />}
    </Page>
  );
}
