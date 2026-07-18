import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import Page from '../components/Page';
import DataTable, { Column } from '../components/DataTable';
import Badge from '../components/Badge';
import { api, errMsg } from '../api/client';

interface RecentGame {
  id: number;
  mode: string;
  status: string;
  guessCount: number;
  finishedAt: string;
  answer: string;
}

interface MyStats {
  totalGames: number;
  wins: number;
  winRate: number;
  avgGuesses: number;
  bestGuesses: number | null;
  multiGames: number;
  multiWins: number;
  recent: RecentGame[];
}

const recentColumns: Column<RecentGame>[] = [
  { key: 'mode', title: '模式', render: (g) => (g.mode === 'easy' ? '简单' : '困难') },
  {
    key: 'status',
    title: '结果',
    render: (g) =>
      g.status === 'won' ? <Badge text="胜利" color="green" /> : <Badge text="失败" color="gray" />,
  },
  { key: 'guessCount', title: '猜测次数' },
  { key: 'answer', title: '答案' },
  {
    key: 'finishedAt',
    title: '时间',
    render: (g) => (g.finishedAt ? new Date(g.finishedAt).toLocaleString('zh-CN') : '-'),
  },
];

export default function Stats() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<MyStats>('/stats/me')
      .then((res) => setStats(res.data))
      .catch((err) => setError(errMsg(err)));
  }, []);

  return (
    <Page title="生涯记录" icon={<BarChart3 size={17} />}>
      {error && <div className="error">{error}</div>}
      {stats && (
        <>
          <div className="card">
            <table className="table">
              <tbody>
                <tr><td>单人总场次</td><td>{stats.totalGames}</td></tr>
                <tr><td>胜场</td><td>{stats.wins}</td></tr>
                <tr><td>胜率</td><td>{(stats.winRate * 100).toFixed(1)}%</td></tr>
                <tr><td>平均猜测次数(胜场)</td><td>{stats.avgGuesses ? stats.avgGuesses.toFixed(2) : '-'}</td></tr>
                <tr><td>最快猜中</td><td>{stats.bestGuesses ?? '-'}</td></tr>
                <tr><td>多人对局 / 胜场</td><td>{stats.multiGames} / {stats.multiWins}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>最近对局</h3>
            <DataTable columns={recentColumns} rows={stats.recent} rowKey={(g) => g.id} empty="还没有对局记录" />
          </div>
        </>
      )}
    </Page>
  );
}
