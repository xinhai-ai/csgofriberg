import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import Page from '../components/Page';
import { api, errMsg } from '../api/client';
import { toast } from '../components/Toast';

interface Announcement {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

export default function Announcements() {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    api
      .get<Announcement[]>('/announcements')
      .then((res) => setItems(res.data))
      .catch((err) => toast.error(errMsg(err)));
  }, []);

  return (
    <Page title="更新公告" icon={<Megaphone size={17} />}>
      {!items.length && <p className="muted">暂无公告</p>}
      {items.map((a) => (
        <div key={a.id} className="card">
          <h3 style={{ marginTop: 0 }}>{a.title}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{a.content}</p>
          <p className="muted">{new Date(a.created_at).toLocaleString('zh-CN')}</p>
        </div>
      ))}
    </Page>
  );
}
