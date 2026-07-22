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
}

type LeaderboardType = 'easy' | 'normal' | 'multi';

interface LeaderboardResponse {
  type: LeaderboardType;
  items: BoardRow[];
  currentUser: { displayId: string; rank: number | null } | null;
}

const LEADERBOARD_TYPES: Array<{ value: LeaderboardType; label: string }> = [
  { value: 'easy', label: '单人简单版' },
  { value: 'normal', label: '单人完整版' },
  { value: 'multi', label: '多人对局' },
];

export default function Leaderboard() {
  const [type, setType] = useState<LeaderboardType>('easy');
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [currentUser, setCurrentUser] = useState<LeaderboardResponse['currentUser']>(null);
  const currentUserId = useAuth((state) => state.user?.id ?? null);

  useEffect(() => {
    let active = true;
    api
      .get<LeaderboardResponse>('/leaderboard', { params: { type } })
      .then((res) => {
        if (!active) return;
        setRows(res.data.items);
        setCurrentUser(res.data.currentUser);
      })
      .catch((err) => toast.error(errMsg(err)));
    return () => { active = false; };
  }, [type]);

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
    ...(type === 'multi' ? [] : [{
      key: 'avgGuesses',
      title: '平均猜测',
      render: (r: BoardRow) => (r.avgGuesses != null ? r.avgGuesses.toFixed(2) : '-'),
    }]),
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
      <div className="leaderboard-mode-tabs" role="tablist" aria-label="排行榜类型">
        {LEADERBOARD_TYPES.map((option) => (
          <button
            type="button"
            role="tab"
            aria-selected={type === option.value}
            className={type === option.value ? 'active' : ''}
            key={option.value}
            onClick={() => setType(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className={`card leaderboard-card leaderboard-card-${type}`}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty={`还没有${LEADERBOARD_TYPES.find((option) => option.value === type)?.label ?? ''}排行记录`}
        />
      </div>
    </Page>
  );
}
