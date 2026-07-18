import { FormEvent, useState } from 'react';

export interface PlayerForm {
  id?: number;
  nickname: string;
  real_name: string;
  nationality: string;
  region: string;
  team: string;
  birth_year: number;
  role: string;
  major_appearances: number;
  is_active: boolean;
}

export const emptyPlayer: PlayerForm = {
  nickname: '',
  real_name: '',
  nationality: '',
  region: '',
  team: '',
  birth_year: 2000,
  role: 'Rifler',
  major_appearances: 0,
  is_active: true,
};

interface Props {
  initial: PlayerForm;
  onSubmit: (form: PlayerForm) => Promise<void>;
  onCancel: () => void;
}

/** 选手新增/编辑表单 */
export default function PlayerEditForm({ initial, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<PlayerForm>(initial);
  const set = (patch: Partial<PlayerForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      <input className="input" placeholder="昵称*" value={form.nickname} onChange={(e) => set({ nickname: e.target.value })} required />
      <input className="input" placeholder="真名" value={form.real_name} onChange={(e) => set({ real_name: e.target.value })} />
      <input className="input" placeholder="国籍*" value={form.nationality} onChange={(e) => set({ nationality: e.target.value })} required />
      <input className="input" placeholder="赛区(欧洲/独联体/北美/南美/亚洲)" value={form.region} onChange={(e) => set({ region: e.target.value })} />
      <input className="input" placeholder="队伍" value={form.team} onChange={(e) => set({ team: e.target.value })} />
      <input className="input" type="number" placeholder="出生年份*" value={form.birth_year} onChange={(e) => set({ birth_year: Number(e.target.value) })} required />
      <select className="input" value={form.role} onChange={(e) => set({ role: e.target.value })}>
        {['Rifler', 'AWPer', 'IGL', 'Entry', 'Lurker', 'Support'].map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <input className="input" type="number" placeholder="Major 次数" value={form.major_appearances} onChange={(e) => set({ major_appearances: Number(e.target.value) })} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
        <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        现役
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <button className="btn btn-green">{form.id ? '保存修改' : '新增选手'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}
