import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PLAYER_ROLE_OPTIONS } from '../../utils/playerRoles';

export interface PlayerForm {
  id?: number;
  nickname: string;
  nationality: string;
  region: string;
  team: string;
  birth_year: number;
  role: string;
  major_championships: number;
  major_appearances: number;
  is_easy: boolean;
  is_active: boolean;
  is_enabled: boolean;
}

export const emptyPlayer: PlayerForm = {
  nickname: '',
  nationality: '',
  region: '',
  team: '',
  birth_year: 2000,
  role: 'Rifler',
  major_championships: 0,
  major_appearances: 0,
  is_easy: false,
  is_active: true,
  is_enabled: true,
};

interface Props {
  initial: PlayerForm;
  onSubmit: (form: PlayerForm) => Promise<void>;
  onCancel: () => void;
}

export default function PlayerEditForm({ initial, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<PlayerForm>(initial);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<PlayerForm>) => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstInputRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError('');
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="admin-player-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div className="admin-player-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="admin-player-dialog-heading">
          <div>
            <h2 id={titleId}>{form.id ? `修改选手: ${form.nickname}` : '新增选手'}</h2>
            <p>完整填写选手属性，带星号的字段为必填项。</p>
          </div>
          <button className="confirm-close" type="button" aria-label="关闭" onClick={onCancel} disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="admin-player-form-grid">
            <label className="admin-player-field">
              <span>选手昵称 *</span>
              <input ref={firstInputRef} className="input" value={form.nickname} onChange={(event) => set({ nickname: event.target.value })} required />
            </label>
            <label className="admin-player-field">
              <span>国籍 *</span>
              <input className="input" value={form.nationality} onChange={(event) => set({ nationality: event.target.value })} required />
            </label>
            <label className="admin-player-field">
              <span>赛区</span>
              <input className="input" value={form.region} onChange={(event) => set({ region: event.target.value })} placeholder="欧洲、独联体、北美等" />
            </label>
            <label className="admin-player-field">
              <span>当前队伍</span>
              <input className="input" value={form.team} onChange={(event) => set({ team: event.target.value })} />
            </label>
            <label className="admin-player-field">
              <span>出生年份 *</span>
              <input className="input" type="number" min="1970" max="2015" value={form.birth_year} onChange={(event) => set({ birth_year: Number(event.target.value) })} required />
            </label>
            <label className="admin-player-field">
              <span>选手位置</span>
              <select className="input" value={form.role} onChange={(event) => set({ role: event.target.value })}>
                {PLAYER_ROLE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="admin-player-field">
              <span>Major 冠军数</span>
              <input className="input" type="number" min="0" value={form.major_championships} onChange={(event) => set({ major_championships: Number(event.target.value) })} />
            </label>
            <label className="admin-player-field">
              <span>Major 参赛次数</span>
              <input className="input" type="number" min="0" value={form.major_appearances} onChange={(event) => set({ major_appearances: Number(event.target.value) })} />
            </label>
          </div>

          <div className="admin-player-flags">
            <label><input type="checkbox" checked={form.is_easy} onChange={(event) => set({ is_easy: event.target.checked })} />加入简单版选手池</label>
            <label><input type="checkbox" checked={form.is_active} onChange={(event) => set({ is_active: event.target.checked })} />现役选手</label>
            <label><input type="checkbox" checked={form.is_enabled} onChange={(event) => set({ is_enabled: event.target.checked })} />允许进入选手池和猜测列表</label>
          </div>

          {submitError && <p className="error admin-player-submit-error">{submitError}</p>}

          <div className="admin-player-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>取消</button>
            <button className="btn btn-green" disabled={saving}>{saving ? '保存中...' : form.id ? '保存修改' : '新增选手'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
