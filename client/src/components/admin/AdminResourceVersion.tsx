import { useState } from 'react';
import { RadioTower } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { RESOURCE_VERSION } from '../../resourceVersion';
import { useConfirm } from '../ConfirmDialog';
import { toast } from '../Toast';

export default function AdminResourceVersion() {
  const confirm = useConfirm();
  const [submitting, setSubmitting] = useState(false);

  const broadcast = async () => {
    const accepted = await confirm({
      title: '广播资源更新?',
      message: '版本不同的在线用户将立即收到刷新提示，之后连接的用户也会收到该提示。',
      confirmLabel: '确认广播',
    });
    if (!accepted) return;

    setSubmitting(true);
    try {
      await api.post('/admin/resource-version/broadcast', { version: RESOURCE_VERSION });
      toast.success('当前资源版本已广播');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card admin-resource-card admin-centered-card">
      <div className="admin-resource-heading">
        <div>
          <h3>资源版本</h3>
          <p className="muted">当前页面版本</p>
        </div>
        <code className="resource-version-value">
          {new Date(Number(RESOURCE_VERSION)).toLocaleString('zh-CN')}
        </code>
      </div>
      <button className="btn btn-green" type="button" disabled={submitting} onClick={() => void broadcast()}>
        <RadioTower size={17} />
        {submitting ? '正在广播...' : '广播当前版本'}
      </button>
    </div>
  );
}
