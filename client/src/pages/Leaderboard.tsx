import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import Page from '../components/Page';
import DataTable, { Column } from '../components/DataTable';
import { api, errMsg } from '../api/client';
import { toast } from '../components/Toast';
import { useAuth } from '../store/auth';

interface BoardRow {
  id: number;
  displayId: string;
  total: number;
  wins: number;
  winRate: number;
  avgGuesses: number | null;
  multiWins: number;
}

interface LeaderboardResponse {
  items: BoardRow[];
  currentUser: { displayId: string; rank: number | null } | null;
}

export default function Leaderboard() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [currentUser, setCurrentUser] = useState<LeaderboardResponse['currentUser']>(null);
  const currentUserId = useAuth((state) => state.user?.id ?? null);

  useEffect(() => {
    api
      .get<LeaderboardResponse>('/leaderboard')
      .then((res) => {
        setRows(res.data.items);
        setCurrentUser(res.data.currentUser);
      })
      .catch((err) => toast.error(errMsg(err)));
  }, []);

  const columns: Column<BoardRow>[] = [
    { key: 'rank', title: '#', render: (r) => rows.indexOf(r) + 1 },
    {
      key: 'displayId',
      title: '玩家',
      render: (row) => (
        <span className="leaderboard-player-label">
          {row.displayId}
          {row.id === currentUserId && <span className="leaderboard-self-marker">我</span>}
        </span>
      ),
    },
    { key: 'wins', title: '胜场' },
    { key: 'total', title: '总场次' },
    { key: 'winRate', title: '胜率', render: (r) => `${(r.winRate * 100).toFixed(1)}%` },
    { key: 'avgGuesses', title: '平均猜测', render: (r) => (r.avgGuesses != null ? r.avgGuesses.toFixed(2) : '-') },
    { key: 'multiWins', title: '多人胜场' },
  ];

  return (
    <Page title="排行榜" icon={<Trophy size={17} />}>
      {currentUser && (
        <div className="leaderboard-self-summary">
          <span>我的排名</span>
          <strong>{currentUser.rank == null ? '暂无排名' : `#${currentUser.rank}`}</strong>
          <span>{currentUser.displayId}</span>
        </div>
      )}
      <div className="card leaderboard-card">
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="还没有玩家上榜" />
      </div>
    </Page>
  );
}
