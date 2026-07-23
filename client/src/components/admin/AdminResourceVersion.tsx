import { useState } from 'react';
import { RadioTower } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { RESOURCE_VERSION } from '../../resourceVersion';
import { useConfirm } from '../ConfirmDialog';
import { toast } from '../Toast';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../../i18n';

export default function AdminResourceVersion() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [submitting, setSubmitting] = useState(false);

  const broadcast = async () => {
    const accepted = await confirm({
      title: t('admin.broadcastTitle'),
      message: t('admin.broadcastMessage'),
      confirmLabel: t('admin.broadcastConfirm'),
    });
    if (!accepted) return;

    setSubmitting(true);
    try {
      await api.post('/admin/resource-version/broadcast', { version: RESOURCE_VERSION });
      toast.success(t('admin.broadcastSuccess'));
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
          <h3>{t('admin.resourcesTitle')}</h3>
          <p className="muted">{t('admin.currentVersion')}</p>
        </div>
        <code className="resource-version-value">
          {new Date(Number(RESOURCE_VERSION)).toLocaleString(currentLocale())}
        </code>
      </div>
      <button className="btn btn-green" type="button" disabled={submitting} onClick={() => void broadcast()}>
        <RadioTower size={17} />
        {submitting ? t('admin.broadcasting') : t('admin.broadcast')}
      </button>
    </div>
  );
}
