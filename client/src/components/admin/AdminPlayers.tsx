import { useCallback, useEffect, useState } from 'react';
import DataTable, { Column } from '../DataTable';
import PlayerEditForm, { PlayerForm, emptyPlayer } from './PlayerEditForm';
import { api, errMsg } from '../../api/client';
import { useConfirm } from '../ConfirmDialog';

interface AdminPlayer extends PlayerForm {
  id: number;
}

/** 管理后台 - 选手管理(列表/新增/编辑/删除/JSON 导入) */
export default function AdminPlayers() {
  const confirm = useConfirm();
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [editing, setEditing] = useState<PlayerForm | null>(null);
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get<AdminPlayer[]>('/admin/players');
      setPlayers(res.data.map((p: any) => ({ ...p, is_active: Boolean(p.is_active) })));
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: PlayerForm) => {
    setError('');
    setMessage('');
    try {
      const { id, ...body } = form;
      if (id) {
        await api.put(`/admin/players/${id}`, body);
      } else {
        await api.post('/admin/players', body);
      }
      setEditing(null);
      setMessage(id ? '修改已保存' : '新增成功');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const remove = async (p: AdminPlayer) => {
    if (!await confirm({
      title: `删除选手 ${p.nickname}?`,
      message: '存在历史对局时会标记为退役，否则会永久删除该选手。',
      confirmLabel: '确认删除',
      tone: 'danger',
    })) return;
    setError('');
    try {
      const res = await api.delete(`/admin/players/${p.id}`);
      setMessage(res.data.softDeleted ? '该选手有历史对局,已标记为退役' : '已删除');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const doImport = async () => {
    setError('');
    setMessage('');
    try {
      const parsed = JSON.parse(importText);
      const list = Array.isArray(parsed) ? parsed : parsed.players;
      const res = await api.post('/admin/players/import', { players: list });
      setMessage(`导入完成:新增 ${res.data.created},更新 ${res.data.updated}`);
      setImportText('');
      await load();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'JSON 格式错误' : errMsg(err));
    }
  };

  const columns: Column<AdminPlayer>[] = [
    { key: 'nickname', title: '昵称' },
    { key: 'nationality', title: '国籍' },
    { key: 'region', title: '赛区' },
    { key: 'team', title: '队伍' },
    { key: 'birth_year', title: '出生年' },
    { key: 'role', title: '位置' },
    { key: 'major_appearances', title: 'Major' },
    { key: 'is_active', title: '状态', render: (p) => (p.is_active ? '现役' : '退役') },
    {
      key: 'actions',
      title: '操作',
      render: (p) => (
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost" onClick={() => setEditing(p)}>编辑</button>
          <button className="btn btn-red" onClick={() => void remove(p)}>删除</button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="card">
        <h3>选手管理(共 {players.length} 名)</h3>
        {message && <p className="muted">{message}</p>}
        {error && <p className="error">{error}</p>}
        {editing ? (
          <PlayerEditForm key={editing.id ?? 'new'} initial={editing} onSubmit={save} onCancel={() => setEditing(null)} />
        ) : (
          <button className="btn btn-green" onClick={() => setEditing(emptyPlayer)}>+ 新增选手</button>
        )}
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <DataTable columns={columns} rows={players} rowKey={(p) => p.id} />
        </div>
      </div>
      <div className="card">
        <h3>JSON 批量导入</h3>
        <p className="muted">
          粘贴选手数组,字段: nickname, real_name, nationality, region, team, birth_year, role,
          major_appearances, is_active。按昵称去重,已存在则更新。
        </p>
        <textarea
          className="input"
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='[{"nickname":"s1mple","nationality":"乌克兰","region":"欧洲","team":"NAVI","birth_year":1997,"role":"AWPer","major_appearances":12,"is_active":true}]'
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => void doImport()} disabled={!importText.trim()}>
          导入
        </button>
      </div>
    </>
  );
}
