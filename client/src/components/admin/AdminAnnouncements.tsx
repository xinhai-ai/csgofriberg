import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useConfirm } from '../ConfirmDialog';
import { toast } from '../Toast';

interface Announcement {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

/** 管理后台 - 公告管理 */
export default function AdminAnnouncements() {
  const confirm = useConfirm();
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get<Announcement[]>('/announcements');
      setItems(res.data);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    try {
      await api.post('/admin/announcements', { title, content });
      setTitle('');
      setContent('');
      toast.success('公告已发布');
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async (id: number) => {
    if (!await confirm({
      title: '删除公告?',
      message: '删除后公告将立即从所有用户页面移除，此操作无法撤销。',
      confirmLabel: '删除公告',
      tone: 'danger',
    })) return;
    try {
      await api.delete(`/admin/announcements/${id}`);
      toast.success('公告已删除');
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="card admin-announcements-card">
      <h3>公告管理</h3>
      <div className="admin-announcement-form">
        <input className="input" placeholder="公告标题" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={4} placeholder="公告内容" value={content} onChange={(e) => setContent(e.target.value)} />
        <button className="btn btn-green" onClick={() => void publish()} disabled={!title.trim() || !content.trim()}>
          发布公告
        </button>
      </div>
      <div className="admin-announcement-list">
        {items.map((a) => (
          <div className="admin-announcement-row" key={a.id}>
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
