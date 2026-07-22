import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Play, Swords, User, Users, X } from 'lucide-react';
import Page from '../components/Page';
import DataTable, { Column } from '../components/DataTable';
import Badge from '../components/Badge';
import GuessBoard from '../components/GuessBoard';
import { PlayerInfoTable } from '../components/AnswerOverlay';
import { api, errMsg } from '../api/client';
import { GuessFeedback, PlayerInfo } from '../types';
import ModalPortal from '../components/ModalPortal';
import { toast } from '../components/Toast';

interface SingleStats {
  totalGames: number;
  wins: number;
  winRate: number;
  avgGuesses: number | null;
  bestGuesses: number | null;
}

interface StatsResponse {
  personal: SingleStats & { multiGames: number; multiWins: number };
  global: SingleStats & { multiGames: number; registeredUsers: number };
}

interface SingleReplayItem {
  type: 'single';
  id: number;
  mode: string;
  status: string;
  guessCount: number;
  finishedAt: string;
  answer: string;
}

interface MultiReplayItem {
  type: 'multi';
  id: number;
  mode: string;
  boType: number;
  finishedAt: string;
  result: 'won' | 'lost' | 'draw';
  me: { score: number };
  opponent: { displayId: string; score: number } | null;
}

interface ReplayPage<T> {
  type: 'single' | 'multi';
  page: number;
  pageSize: number;
  hasNext: boolean;
  items: T[];
}

interface SingleReplay {
  type: 'single';
  id: number;
  mode: string;
  status: string;
  guessCount: number;
  createdAt: string;
  finishedAt: string;
  answer: PlayerInfo;
  guesses: GuessFeedback[];
}

interface MultiReplayRound {
  round: number;
  reason: string;
  winner: 'me' | 'opponent' | null;
  answer: PlayerInfo;
  me: { guesses: GuessFeedback[] };
  opponent: { guesses: GuessFeedback[] };
}

interface MultiReplay {
  type: 'multi';
  id: number;
  mode: string;
  boType: number;
  finishedAt: string;
  result: 'won' | 'lost' | 'draw';
  me: { score: number };
  opponent: { displayId: string; score: number };
  rounds: MultiReplayRound[];
}

type Replay = SingleReplay | MultiReplay;
type ReplayType = 'single' | 'multi';

function formatAverage(value: number | null): string {
  return value == null ? '-' : value.toFixed(2);
}

function formatMode(mode: string): string {
  return mode === 'easy' ? '简单' : '完整';
}

function formatMultiResult(result: MultiReplayItem['result']): string {
  return result === 'won' ? '胜利' : result === 'lost' ? '失败' : '平局';
}

function StatTable({ rows }: { rows: [string, string | number][] }) {
  return (
    <table className="table stats-summary-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}><td>{label}</td><td>{value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function AnswerSection({ answer }: { answer: PlayerInfo }) {
  return (
    <section className="replay-answer" aria-label="正确答案">
      <h3>正确答案: {answer.nickname}</h3>
      <PlayerInfoTable
        answer={{
          nickname: answer.nickname,
          team: answer.team,
          nationality: `${answer.nationality}(${answer.region})`,
          role: answer.role,
          majorChampionships: answer.majorChampionships,
          majorAppearances: answer.majorAppearances,
        }}
      />
    </section>
  );
}

function ReplayDialog({ replay, onClose }: { replay: Replay; onClose: () => void }) {
  const titleId = useId();
  const [roundIndex, setRoundIndex] = useState(0);
  const roundCount = replay.type === 'multi' ? replay.rounds.length : 0;
  const activeRound = replay.type === 'multi' ? replay.rounds[roundIndex] : null;

  useEffect(() => {
    setRoundIndex(0);
  }, [replay.id, replay.type]);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (replay.type === 'multi' && replay.rounds.length > 0 && event.key === 'ArrowLeft') {
        setRoundIndex((current) => Math.max(0, current - 1));
      }
      if (replay.type === 'multi' && replay.rounds.length > 0 && event.key === 'ArrowRight') {
        setRoundIndex((current) => Math.min(replay.rounds.length - 1, current + 1));
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, replay]);

  return (
    <ModalPortal>
      <div className="replay-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <div className="replay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="replay-heading">
            <div>
              <h2 id={titleId}>{replay.type === 'single' ? '单人对局回放' : '多人对局回放'}</h2>
              <p>
                {formatMode(replay.mode)} · {replay.type === 'single'
                  ? `${replay.status === 'won' ? '胜利' : '失败'} · ${replay.guessCount} 次猜测`
                  : `BO${replay.boType} · 我方 / ${replay.opponent.displayId} · ${formatMultiResult(replay.result)} · ${replay.me.score}:${replay.opponent.score}`}
              </p>
            </div>
            <button className="confirm-close" type="button" aria-label="关闭回放" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="replay-dialog-body">
            {replay.type === 'single' ? (
              <>
                <AnswerSection answer={replay.answer} />
                <section className="replay-guesses" aria-label="猜测过程">
                  <h3>猜测过程</h3>
                  {replay.guesses.length
                    ? <GuessBoard guesses={replay.guesses} />
                    : <p className="muted">本局未进行猜测。</p>}
                </section>
              </>
            ) : (
              <div className="replay-rounds">
                {activeRound ? (
                  <section className="replay-round" key={activeRound.round}>
                    <div className="replay-round-heading">
                      <h3>第 {activeRound.round} 轮</h3>
                      <Badge
                        text={activeRound.winner === 'me' ? '我方获胜' : activeRound.winner === 'opponent' ? '对方获胜' : '平局'}
                        color={activeRound.winner === 'me' ? 'green' : 'gray'}
                      />
                    </div>
                    <AnswerSection answer={activeRound.answer} />
                    <div className="replay-sides">
                      <div className="replay-side">
                        <h4><User size={15} />我方</h4>
                        {activeRound.me.guesses.length
                          ? <GuessBoard guesses={activeRound.me.guesses} />
                          : <p className="muted">本轮未猜测</p>}
                      </div>
                      <div className="replay-side">
                        <h4><Swords size={15} />{replay.opponent.displayId}</h4>
                        {activeRound.opponent.guesses.length
                          ? <GuessBoard guesses={activeRound.opponent.guesses} />
                          : <p className="muted">本轮未猜测</p>}
                      </div>
                    </div>
                  </section>
                ) : <p className="muted">这场对局没有可用的逐轮记录。</p>}
                {roundCount > 0 && (
                  <div className="replay-round-pagination" aria-label="回放轮次翻页">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      aria-label="上一轮"
                      title="上一轮"
                      disabled={roundIndex === 0}
                      onClick={() => setRoundIndex((current) => Math.max(0, current - 1))}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>第 {roundIndex + 1} / {roundCount} 轮</span>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      aria-label="下一轮"
                      title="下一轮"
                      disabled={roundIndex >= roundCount - 1}
                      onClick={() => setRoundIndex((current) => Math.min(roundCount - 1, current + 1))}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export default function Stats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [type, setType] = useState<ReplayType>('single');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Array<SingleReplayItem | MultiReplayItem>>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayLoadingId, setReplayLoadingId] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api.get<StatsResponse>('/stats/me')
      .then((res) => setStats(res.data))
      .catch((err) => toast.error(errMsg(err)));
  }, []);

  const loadReplays = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await api.get<ReplayPage<SingleReplayItem | MultiReplayItem>>('/stats/replays', {
        params: { type, page, pageSize: 15 },
      });
      if (currentRequest !== requestId.current) return;
      setItems(res.data.items);
      setHasNext(res.data.hasNext);
    } catch (err) {
      if (currentRequest === requestId.current) toast.error(errMsg(err));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [page, type]);

  useEffect(() => { void loadReplays(); }, [loadReplays]);

  const chooseType = (next: ReplayType) => {
    setType(next);
    setPage(1);
    setItems([]);
  };

  const openReplay = async (item: SingleReplayItem | MultiReplayItem) => {
    setReplayLoadingId(item.id);
    try {
      if (item.type === 'single') {
        const res = await api.get<Omit<SingleReplay, 'type'>>(`/stats/games/${item.id}/replay`);
        setReplay({ type: 'single', ...res.data });
      } else {
        const res = await api.get<Omit<MultiReplay, 'type'>>(`/stats/matches/${item.id}/replay`);
        setReplay({ type: 'multi', ...res.data });
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setReplayLoadingId(null);
    }
  };

  const replayButton = (item: SingleReplayItem | MultiReplayItem) => (
    <button
      className="btn btn-ghost btn-sm stats-replay-button"
      type="button"
      onClick={() => void openReplay(item)}
      disabled={replayLoadingId === item.id}
      aria-label={`回放对局 ${item.id}`}
    >
      <Play size={14} />
      {replayLoadingId === item.id ? '加载中' : '回放'}
    </button>
  );

  const singleColumns: Column<SingleReplayItem>[] = [
    { key: 'mode', title: '模式', render: (game) => formatMode(game.mode) },
    { key: 'status', title: '结果', render: (game) => game.status === 'won'
      ? <Badge text="胜利" color="green" /> : <Badge text="失败" color="gray" /> },
    { key: 'guessCount', title: '猜测' },
    { key: 'answer', title: '答案' },
    { key: 'finishedAt', title: '时间', render: (game) => new Date(game.finishedAt).toLocaleString('zh-CN') },
    { key: 'replay', title: '回放', render: replayButton },
  ];

  const multiColumns: Column<MultiReplayItem>[] = [
    { key: 'mode', title: '模式', render: (game) => `${formatMode(game.mode)} · BO${game.boType}` },
    { key: 'result', title: '结果', render: (game) => game.result === 'won'
      ? <Badge text="胜利" color="green" />
      : game.result === 'draw'
        ? <Badge text="平局" color="gray" />
        : <Badge text="失败" color="gray" /> },
    { key: 'opponent', title: '对阵', render: (game) => `我方 / ${game.opponent?.displayId ?? '未知对手'}` },
    { key: 'score', title: '比分', render: (game) => `${game.me.score}:${game.opponent?.score ?? 0}` },
    { key: 'finishedAt', title: '时间', render: (game) => new Date(game.finishedAt).toLocaleString('zh-CN') },
    { key: 'replay', title: '回放', render: replayButton },
  ];

  return (
    <Page title="统计" icon={<BarChart3 size={17} />}>
      <div className="stats-content">
        {stats && (
          <div className="stats-overview-grid">
            <section className="card">
              <h3><BarChart3 size={16} />个人统计</h3>
              <StatTable rows={[
                ['单人总场次', stats.personal.totalGames],
                ['单人胜场', stats.personal.wins],
                ['单人胜率', `${(stats.personal.winRate * 100).toFixed(1)}%`],
                ['平均猜测次数(胜场)', formatAverage(stats.personal.avgGuesses)],
                ['最快猜中', stats.personal.bestGuesses ?? '-'],
                ['多人对局 / 胜场', `${stats.personal.multiGames} / ${stats.personal.multiWins}`],
              ]} />
            </section>
            <section className="card">
              <h3><Users size={16} />全站统计</h3>
              <StatTable rows={[
                ['注册用户', stats.global.registeredUsers],
                ['单人总场次', stats.global.totalGames],
                ['单人胜场', stats.global.wins],
                ['全站单人胜率', `${(stats.global.winRate * 100).toFixed(1)}%`],
                ['平均猜测次数(胜场)', formatAverage(stats.global.avgGuesses)],
                ['多人对局', stats.global.multiGames],
              ]} />
            </section>
          </div>
        )}

        <section className="card stats-recent-card">
          <div className="stats-replay-toolbar">
            <h3>个人回放</h3>
            <div className="stats-replay-segments" role="tablist" aria-label="回放类型">
              <button type="button" role="tab" aria-selected={type === 'single'} className={type === 'single' ? 'active' : ''} onClick={() => chooseType('single')}>
                <User size={15} />单人
              </button>
              <button type="button" role="tab" aria-selected={type === 'multi'} className={type === 'multi' ? 'active' : ''} onClick={() => chooseType('multi')}>
                <Swords size={15} />多人
              </button>
            </div>
          </div>
          <div className="stats-recent-table stats-replay-desktop-list">
            {type === 'single' ? (
              <DataTable
                columns={singleColumns}
                rows={items.filter((item): item is SingleReplayItem => item.type === 'single')}
                rowKey={(game) => game.id}
                empty={loading ? '正在加载...' : '还没有单人对局记录'}
              />
            ) : (
              <DataTable
                columns={multiColumns}
                rows={items.filter((item): item is MultiReplayItem => item.type === 'multi')}
                rowKey={(game) => game.id}
                empty={loading ? '正在加载...' : '还没有多人对局记录'}
              />
            )}
          </div>
          <div className="stats-replay-mobile-list">
            {items.length ? items.map((item) => (
              <article className="stats-replay-mobile-item" key={`${item.type}:${item.id}`}>
                <div className="stats-replay-mobile-heading">
                  <strong>{item.type === 'single'
                    ? formatMode(item.mode)
                    : `${formatMode(item.mode)} · BO${item.boType}`}</strong>
                  <Badge
                    text={(item.type === 'single' ? item.status : item.result) === 'won' ? '胜利' : '失败'}
                    color={(item.type === 'single' ? item.status : item.result) === 'won' ? 'green' : 'gray'}
                  />
                </div>
                <div className="stats-replay-mobile-details">
                  {item.type === 'single' ? (
                    <>
                      <span>答案 <strong>{item.answer}</strong></span>
                      <span>猜测 <strong>{item.guessCount}</strong></span>
                    </>
                  ) : (
                    <>
                      <span>对阵 <strong>我方 / {item.opponent?.displayId ?? '未知对手'}</strong></span>
                      <span>比分 <strong>{item.me.score}:{item.opponent?.score ?? 0}</strong></span>
                    </>
                  )}
                </div>
                <div className="stats-replay-mobile-footer">
                  <time dateTime={item.finishedAt}>{new Date(item.finishedAt).toLocaleString('zh-CN')}</time>
                  {replayButton(item)}
                </div>
              </article>
            )) : <p className="muted">{loading
              ? '正在加载...'
              : type === 'single' ? '还没有单人对局记录' : '还没有多人对局记录'}</p>}
          </div>
          <div className="stats-pagination">
            <button className="btn btn-ghost" type="button" aria-label="上一页" title="上一页" disabled={page === 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              <ChevronLeft size={17} />
            </button>
            <span>第 {page} 页</span>
            <button className="btn btn-ghost" type="button" aria-label="下一页" title="下一页" disabled={!hasNext || loading} onClick={() => setPage((current) => current + 1)}>
              <ChevronRight size={17} />
            </button>
          </div>
        </section>
      </div>
      {replay && <ReplayDialog replay={replay} onClose={() => setReplay(null)} />}
    </Page>
  );
}
