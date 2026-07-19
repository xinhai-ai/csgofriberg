import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import DataTable, { Column } from '../DataTable';
import PlayerEditForm, { PlayerForm, emptyPlayer } from './PlayerEditForm';
import { api, errMsg } from '../../api/client';
import { useConfirm } from '../ConfirmDialog';
import { playerRoleLabel } from '../../utils/playerRoles';
import { clearPlayerListCache } from '../../api/playerList';

interface AdminPlayer extends PlayerForm {
  id: number;
}

interface PlayerPage {
  players: AdminPlayer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 管理后台 - 选手管理(列表/新增/编辑/删除/JSON 导入) */
export default function AdminPlayers() {
  const confirm = useConfirm();
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PlayerForm | null>(null);
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await api.get<PlayerPage>('/admin/players', {
        params: { page, pageSize, search: search || undefined },
      });
      if (currentRequest !== requestId.current) return;
      setPlayers(res.data.players.map((p) => ({
        ...p,
        is_easy: Boolean(p.is_easy),
        is_active: Boolean(p.is_active),
      })));
      setTotal(res.data.total);
      if (res.data.page !== page) setPage(res.data.page);
    } catch (err) {
      if (currentRequest === requestId.current) setError(errMsg(err));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

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
      clearPlayerListCache();
      setEditing(null);
      setMessage(id ? '修改已保存' : '新增成功');
      if (!id && page !== 1) setPage(1);
      else await load();
    } catch (err) {
      const message = errMsg(err);
      setError(message);
      throw new Error(message);
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
      clearPlayerListCache();
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
      clearPlayerListCache();
      setMessage(`导入完成:新增 ${res.data.created},更新 ${res.data.updated}`);
      setImportText('');
      if (page !== 1) setPage(1);
      else await load();
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
    { key: 'role', title: '位置', render: (p) => playerRoleLabel(p.role) },
    { key: 'major_championships', title: 'Major 冠军' },
    { key: 'major_appearances', title: 'Major' },
    { key: 'is_easy', title: '简单版', render: (p) => (p.is_easy ? '是' : '否') },
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
        <h3>选手管理(共 {total} 名)</h3>
        {message && <p className="muted">{message}</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-green" onClick={() => setEditing({ ...emptyPlayer })}>+ 新增选手</button>
        <div className="admin-list-toolbar">
          <label className="admin-search">
            <Search size={16} />
            <input
              className="input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索昵称、国家、赛区或队伍"
            />
          </label>
          <label className="admin-page-size">
            每页
            <select
              className="input"
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
            >
              {[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <DataTable
            columns={columns}
            rows={players}
            rowKey={(p) => p.id}
            empty={loading ? '正在加载...' : search ? '没有匹配的选手' : '暂无选手'}
          />
        </div>
        <div className="admin-pagination">
          <span className="muted">
            {total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} / ${total}` : '0 条'}
          </span>
          <div className="admin-pagination-actions">
            <button
              className="btn btn-ghost"
              aria-label="上一页"
              title="上一页"
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={17} />
            </button>
            <span>第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span>
            <button
              className="btn btn-ghost"
              aria-label="下一页"
              title="下一页"
              disabled={loading || page >= Math.max(1, Math.ceil(total / pageSize))}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>JSON 批量导入</h3>
        <p className="muted">
          粘贴选手数组,字段: nickname, nationality, region, team, birth_year, role,
          major_championships, major_appearances, is_easy, is_active。按昵称去重,已存在则更新。
        </p>
        <textarea
          className="input"
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='[{"nickname":"s1mple","nationality":"乌克兰","region":"欧洲","team":"NAVI","birth_year":1997,"role":"AWPer","major_championships":1,"major_appearances":12,"is_easy":true,"is_active":true}]'
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => void doImport()} disabled={!importText.trim()}>
          导入
        </button>
      </div>
      {editing && (
        <PlayerEditForm
          key={editing.id ?? 'new'}
          initial={editing}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}
