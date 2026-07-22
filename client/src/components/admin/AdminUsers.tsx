import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, History, Play, Search, Swords, User, X } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import type { PlayerPerformanceStats } from '../../types';
import DataTable, { Column } from '../DataTable';
import ModalPortal from '../ModalPortal';
import { toast } from '../Toast';
import Badge from '../Badge';
import ReplayDialog, {
  type MultiReplay,
  type Replay,
  type SingleReplay,
} from '../ReplayDialog';

interface AdminUser {
  id: number;
  username: string;
  displayId: string;
  role: 'user' | 'admin';
  createdAt: string;
}

interface UserPage {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UserStatsView {
  user: AdminUser;
  stats: PlayerPerformanceStats;
}

interface SingleUserGame {
  type: 'single';
  id: number;
  mode: 'easy' | 'normal';
  status: string;
  guessCount: number;
  answer: string;
  finishedAt: string;
}

interface MultiUserGame {
  type: 'multi';
  id: number;
  mode: 'easy' | 'normal';
  boType: number;
  result: 'won' | 'lost' | 'draw';
  me: { score: number };
  opponent: { displayId: string; score: number } | null;
  finishedAt: string;
}

type UserGame = SingleUserGame | MultiUserGame;

interface UserGamePage {
  type: 'single' | 'multi';
  page: number;
  pageSize: number;
  hasNext: boolean;
  items: UserGame[];
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN');
}

function formatWinRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMode(mode: 'easy' | 'normal'): string {
  return mode === 'normal' ? '完整版' : '简单版';
}

function UserStatsDialog({ view, onClose }: { view: UserStatsView; onClose: () => void }) {
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const { single, multi } = view.stats;
  return (
    <ModalPortal>
      <div className="admin-player-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <div className="admin-player-dialog admin-user-stats-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-user-stats-title">
          <div className="admin-player-dialog-heading">
            <div>
              <h2 id="admin-user-stats-title">用户战绩</h2>
              <p>{view.user.username} · {view.user.displayId}</p>
            </div>
            <button className="confirm-close" type="button" aria-label="关闭用户战绩" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="admin-user-stats-grid">
            <section>
              <h3>单人战绩</h3>
              <dl className="player-stats-list">
                <div><dt>总场次</dt><dd>{single.games}</dd></div>
                <div><dt>胜 / 负</dt><dd>{single.wins} / {single.losses}</dd></div>
                <div><dt>胜率</dt><dd>{formatWinRate(single.winRate)}</dd></div>
                <div><dt>胜场平均猜测</dt><dd>{single.avgGuesses?.toFixed(1) ?? '-'}</dd></div>
                <div><dt>最快猜中</dt><dd>{single.bestGuesses ?? '-'}</dd></div>
              </dl>
            </section>
            <section>
              <h3>多人战绩</h3>
              <dl className="player-stats-list">
                <div><dt>总场次</dt><dd>{multi.games}</dd></div>
                <div><dt>胜 / 负</dt><dd>{multi.wins} / {multi.losses}</dd></div>
                <div><dt>胜率</dt><dd>{formatWinRate(multi.winRate)}</dd></div>
              </dl>
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function UserGamesDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [type, setType] = useState<'single' | 'multi'>('single');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<UserGame[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayLoadingId, setReplayLoadingId] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !replay) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, replay]);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    api.get<UserGamePage>(`/admin/users/${user.id}/games`, {
      params: { type, page, pageSize: 10 },
    }).then((res) => {
      if (currentRequest !== requestId.current) return;
      setItems(res.data.items);
      setHasNext(res.data.hasNext);
    }).catch((err) => {
      if (currentRequest === requestId.current) toast.error(errMsg(err));
    }).finally(() => {
      if (currentRequest === requestId.current) setLoading(false);
    });
  }, [page, type, user.id]);

  const chooseType = (next: 'single' | 'multi') => {
    setType(next);
    setPage(1);
    setItems([]);
  };

  const openReplay = async (game: UserGame) => {
    setReplayLoadingId(game.id);
    try {
      if (game.type === 'single') {
        const res = await api.get<Omit<SingleReplay, 'type'>>(
          `/admin/users/${user.id}/games/${game.id}/replay`
        );
        setReplay({ type: 'single', ...res.data });
      } else {
        const res = await api.get<Omit<MultiReplay, 'type'>>(
          `/admin/users/${user.id}/matches/${game.id}/replay`
        );
        setReplay({ type: 'multi', ...res.data });
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setReplayLoadingId(null);
    }
  };

  return (
    <>
      <ModalPortal>
        <div className="admin-player-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !replay) onClose();
        }}>
          <div className="admin-player-dialog admin-user-games-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-user-games-title">
          <div className="admin-player-dialog-heading">
            <div>
              <h2 id="admin-user-games-title">具体对局</h2>
              <p>{user.username} · {user.displayId}</p>
            </div>
            <button className="confirm-close" type="button" aria-label="关闭具体对局" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="stats-replay-segments admin-user-game-tabs" role="tablist" aria-label="对局类型">
            <button type="button" role="tab" aria-selected={type === 'single'} className={type === 'single' ? 'active' : ''} onClick={() => chooseType('single')}>
              <User size={15} />单人
            </button>
            <button type="button" role="tab" aria-selected={type === 'multi'} className={type === 'multi' ? 'active' : ''} onClick={() => chooseType('multi')}>
              <Swords size={15} />多人
            </button>
          </div>
          <div className="admin-user-game-list">
            {items.length ? items.map((game) => {
              const result = game.type === 'single' ? game.status : game.result;
              const label = result === 'won' ? '胜利' : result === 'draw' ? '平局' : '失败';
              return (
                <article className="admin-user-game-item" key={`${game.type}:${game.id}`}>
                  <div className="admin-user-game-heading">
                    <strong>{game.type === 'single'
                      ? formatMode(game.mode)
                      : `${formatMode(game.mode)} · BO${game.boType}`}</strong>
                    <Badge text={label} color={result === 'won' ? 'green' : 'gray'} />
                  </div>
                  <div className="admin-user-game-details">
                    {game.type === 'single' ? (
                      <>
                        <span>答案 <strong>{game.answer}</strong></span>
                        <span>猜测 <strong>{game.guessCount}</strong></span>
                      </>
                    ) : (
                      <>
                        <span>对手 <strong>{game.opponent?.displayId ?? '未知对手'}</strong></span>
                        <span>比分 <strong>{game.me.score}:{game.opponent?.score ?? 0}</strong></span>
                      </>
                    )}
                  </div>
                  <div className="admin-user-game-footer">
                    <time dateTime={game.finishedAt}>{formatDate(game.finishedAt)}</time>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={replayLoadingId !== null}
                      onClick={() => void openReplay(game)}
                    >
                      <Play size={14} />
                      {replayLoadingId === game.id ? '加载中' : '回放'}
                    </button>
                  </div>
                </article>
              );
            }) : <p className="muted admin-user-game-empty">{loading
              ? '正在加载...'
              : type === 'single' ? '没有单人对局记录' : '没有多人对局记录'}</p>}
          </div>
          <div className="admin-pagination admin-user-game-pagination">
            <button className="btn btn-ghost" type="button" aria-label="上一页" title="上一页" disabled={page === 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              <ChevronLeft size={17} />
            </button>
            <span>第 {page} 页</span>
            <button className="btn btn-ghost" type="button" aria-label="下一页" title="下一页" disabled={!hasNext || loading} onClick={() => setPage((current) => current + 1)}>
              <ChevronRight size={17} />
            </button>
          </div>
          </div>
        </div>
      </ModalPortal>
      {replay && <ReplayDialog replay={replay} onClose={() => setReplay(null)} />}
    </>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [statsLoadingId, setStatsLoadingId] = useState<number | null>(null);
  const [statsView, setStatsView] = useState<UserStatsView | null>(null);
  const [gamesUser, setGamesUser] = useState<AdminUser | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await api.get<UserPage>('/admin/users', {
        params: { page, pageSize, search: search || undefined },
      });
      if (currentRequest !== requestId.current) return;
      setUsers(res.data.users);
      setTotal(res.data.total);
      if (res.data.page !== page) setPage(res.data.page);
    } catch (err) {
      if (currentRequest === requestId.current) toast.error(errMsg(err));
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

  const viewStats = async (user: AdminUser) => {
    if (statsLoadingId !== null) return;
    setStatsLoadingId(user.id);
    try {
      const res = await api.get<UserStatsView>(`/admin/users/${user.id}/stats`);
      setStatsView(res.data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setStatsLoadingId(null);
    }
  };

  const columns: Column<AdminUser>[] = [
    { key: 'username', title: '用户名' },
    { key: 'displayId', title: '匿名 ID' },
    { key: 'role', title: '权限', render: (user) => user.role === 'admin' ? '管理员' : '用户' },
    { key: 'createdAt', title: '注册时间', render: (user) => formatDate(user.createdAt) },
    {
      key: 'actions',
      title: '操作',
      render: (user) => (
        <span className="admin-user-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={statsLoadingId !== null}
            onClick={() => void viewStats(user)}
          >
            <Eye size={15} />
            {statsLoadingId === user.id ? '查询中' : '查看战绩'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setGamesUser(user)}>
            <History size={15} />
            对局记录
          </button>
        </span>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <div className="card admin-users-card">
        <div className="admin-players-header">
          <div className="admin-players-title">
            <h3>用户管理</h3>
            <p className="muted">共 {total} 名注册用户</p>
          </div>
        </div>
        <div className="admin-list-toolbar">
          <label className="admin-search">
            <Search size={16} />
            <input
              className="input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索用户名或匿名 ID"
            />
          </label>
          <label className="admin-page-size">
            <span>每页显示</span>
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
        <div className="admin-users-table">
          <DataTable
            columns={columns}
            rows={users}
            rowKey={(user) => user.id}
            empty={loading ? '正在加载...' : search ? '没有匹配的用户' : '暂无注册用户'}
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
            <span>第 {page} / {totalPages} 页</span>
            <button
              className="btn btn-ghost"
              aria-label="下一页"
              title="下一页"
              disabled={loading || page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
      {statsView && <UserStatsDialog view={statsView} onClose={() => setStatsView(null)} />}
      {gamesUser && <UserGamesDialog user={gamesUser} onClose={() => setGamesUser(null)} />}
    </>
  );
}
