import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useConfirm } from '../ConfirmDialog';
import { toast } from '../Toast';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../../i18n';

interface Announcement {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

/** 管理后台 - 公告管理 */
export default function AdminAnnouncements() {
  const { t } = useTranslation();
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
      toast.success(t('admin.announcementPublished'));
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async (id: number) => {
    if (!await confirm({
      title: t('admin.deleteAnnouncementTitle'),
      message: t('admin.deleteAnnouncementMessage'),
      confirmLabel: t('admin.deleteAnnouncementConfirm'),
      tone: 'danger',
    })) return;
    try {
      await api.delete(`/admin/announcements/${id}`);
      toast.success(t('admin.announcementDeleted'));
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="card admin-announcements-card">
      <h3>{t('admin.announcementsTitle')}</h3>
      <div className="admin-announcement-form">
        <input className="input" placeholder={t('admin.announcementTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={4} placeholder={t('admin.announcementContent')} value={content} onChange={(e) => setContent(e.target.value)} />
        <button className="btn btn-green" onClick={() => void publish()} disabled={!title.trim() || !content.trim()}>
          {t('admin.publish')}
        </button>
      </div>
      <div className="admin-announcement-list">
        {items.map((a) => (
          <div className="admin-announcement-row" key={a.id}>
            <span>
              <b>{a.title}</b>{' '}
              <span className="muted">{new Date(a.created_at).toLocaleString(currentLocale())}</span>
            </span>
            <button className="btn btn-red" onClick={() => void remove(a.id)}>{t('admin.deleteAnnouncementConfirm')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
