import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';

interface Announcement {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

/** 管理后台 - 公告管理 */
export default function AdminAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get<Announcement[]>('/announcements');
      setItems(res.data);
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    setError('');
    try {
      await api.post('/admin/announcements', { title, content });
      setTitle('');
      setContent('');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const remove = async (id: number) => {
    if (!confirm('确定删除该公告?')) return;
    try {
      await api.delete(`/admin/announcements/${id}`);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="card">
      <h3>公告管理</h3>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="input" placeholder="公告标题" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={4} placeholder="公告内容" value={content} onChange={(e) => setContent(e.target.value)} />
        <button className="btn btn-green" onClick={() => void publish()} disabled={!title.trim() || !content.trim()}>
          发布公告
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        {items.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <span>
              <b>{a.title}</b>{' '}
              <span className="muted">{new Date(a.created_at).toLocaleString('zh-CN')}</span>
            </span>
            <button className="btn btn-red" onClick={() => void remove(a.id)}>删除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
