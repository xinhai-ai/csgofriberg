import { useEffect, useId, useState } from 'react';
import { BarChart3, Play, Users, X } from 'lucide-react';
import Page from '../components/Page';
import DataTable, { Column } from '../components/DataTable';
import Badge from '../components/Badge';
import GuessBoard from '../components/GuessBoard';
import { PlayerInfoTable } from '../components/AnswerOverlay';
import { api, errMsg } from '../api/client';
import { GuessFeedback, PlayerInfo } from '../types';
import ModalPortal from '../components/ModalPortal';

interface RecentGame {
  id: number;
  mode: string;
  status: string;
  guessCount: number;
  finishedAt: string;
  answer: string;
}

interface SingleStats {
  totalGames: number;
  wins: number;
  winRate: number;
  avgGuesses: number | null;
  bestGuesses: number | null;
}

interface PersonalStats extends SingleStats {
  multiGames: number;
  multiWins: number;
}

interface GlobalStats extends SingleStats {
  multiGames: number;
  registeredUsers: number;
}

interface StatsResponse {
  personal: PersonalStats;
  global: GlobalStats;
  recent: RecentGame[];
}

interface ReplayGame {
  id: number;
  mode: string;
  status: string;
  guessCount: number;
  createdAt: string;
  finishedAt: string;
  answer: PlayerInfo;
  guesses: GuessFeedback[];
}

function formatAverage(value: number | null): string {
  return value == null ? '-' : value.toFixed(2);
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

function ReplayDialog({ replay, onClose }: { replay: ReplayGame; onClose: () => void }) {
  const titleId = useId();

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

  return (
    <ModalPortal>
      <div
        className="replay-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="replay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="replay-heading">
          <div>
            <h2 id={titleId}>对局回放</h2>
            <p>
              {replay.mode === 'easy' ? '简单版' : '完整版'} ·
              {replay.status === 'won' ? ' 胜利' : ' 失败'} · {replay.guessCount} 次猜测
            </p>
          </div>
          <button className="confirm-close" type="button" aria-label="关闭回放" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <section className="replay-answer" aria-label="正确答案">
          <h3>正确答案: {replay.answer.nickname}</h3>
          <PlayerInfoTable
            answer={{
              nickname: replay.answer.nickname,
              team: replay.answer.team,
              nationality: `${replay.answer.nationality}(${replay.answer.region})`,
              role: replay.answer.role,
              majorChampionships: replay.answer.majorChampionships,
              majorAppearances: replay.answer.majorAppearances,
            }}
          />
        </section>

        <section className="replay-guesses" aria-label="猜测过程">
          <h3>猜测过程</h3>
          {replay.guesses.length
            ? <GuessBoard guesses={replay.guesses} />
            : <p className="muted">本局未进行猜测。</p>}
        </section>
        </div>
      </div>
    </ModalPortal>
  );
}

export default function Stats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [replay, setReplay] = useState<ReplayGame | null>(null);
  const [replayLoadingId, setReplayLoadingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<StatsResponse>('/stats/me')
      .then((res) => setStats(res.data))
      .catch((err) => setError(errMsg(err)));
  }, []);

  const openReplay = async (id: number) => {
    setError('');
    setReplayLoadingId(id);
    try {
      const res = await api.get<ReplayGame>(`/stats/games/${id}/replay`);
      setReplay(res.data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setReplayLoadingId(null);
    }
  };

  const recentColumns: Column<RecentGame>[] = [
    { key: 'mode', title: '模式', render: (game) => (game.mode === 'easy' ? '简单' : '完整') },
    {
      key: 'status',
      title: '结果',
      render: (game) => game.status === 'won'
        ? <Badge text="胜利" color="green" />
        : <Badge text="失败" color="gray" />,
    },
    { key: 'guessCount', title: '猜测' },
    { key: 'answer', title: '答案' },
    {
      key: 'finishedAt',
      title: '时间',
      render: (game) => game.finishedAt ? new Date(game.finishedAt).toLocaleString('zh-CN') : '-',
    },
    {
      key: 'replay',
      title: '回放',
      render: (game) => (
        <button
          className="btn btn-ghost btn-sm stats-replay-button"
          type="button"
          onClick={() => void openReplay(game.id)}
          disabled={replayLoadingId === game.id}
          aria-label={`回放对局 ${game.id}`}
        >
          <Play size={14} />
          {replayLoadingId === game.id ? '加载中' : '回放'}
        </button>
      ),
    },
  ];

  return (
    <Page title="统计" icon={<BarChart3 size={17} />}>
      <div className="stats-content">
        {error && <div className="error stats-error">{error}</div>}
        {stats && (
          <>
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
            <section className="card stats-recent-card">
              <h3>最近对局</h3>
              <div className="stats-recent-table">
                <DataTable
                  columns={recentColumns}
                  rows={stats.recent}
                  rowKey={(game) => game.id}
                  empty="还没有对局记录"
                />
              </div>
            </section>
          </>
        )}
      </div>
      {replay && <ReplayDialog replay={replay} onClose={() => setReplay(null)} />}
    </Page>
  );
}
