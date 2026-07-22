import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import Page from '../components/Page';
import DataTable, { Column } from '../components/DataTable';
import { api, errMsg } from '../api/client';
import { toast } from '../components/Toast';

interface BoardRow {
  id: number;
  displayId: string;
  total: number;
  wins: number;
  winRate: number;
  avgGuesses: number | null;
  multiWins: number;
}

export default function Leaderboard() {
  const [rows, setRows] = useState<BoardRow[]>([]);

  useEffect(() => {
    api
      .get<BoardRow[]>('/leaderboard')
      .then((res) => setRows(res.data))
      .catch((err) => toast.error(errMsg(err)));
  }, []);

  const columns: Column<BoardRow>[] = [
    { key: 'rank', title: '#', render: (r) => rows.indexOf(r) + 1 },
    { key: 'displayId', title: '玩家' },
    { key: 'wins', title: '胜场' },
    { key: 'total', title: '总场次' },
    { key: 'winRate', title: '胜率', render: (r) => `${(r.winRate * 100).toFixed(1)}%` },
    { key: 'avgGuesses', title: '平均猜测', render: (r) => (r.avgGuesses != null ? r.avgGuesses.toFixed(2) : '-') },
    { key: 'multiWins', title: '多人胜场' },
  ];

  return (
    <Page title="排行榜" icon={<Trophy size={17} />}>
      <div className="card" style={{ overflowX: 'auto' }}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="还没有玩家上榜" />
      </div>
    </Page>
  );
}
