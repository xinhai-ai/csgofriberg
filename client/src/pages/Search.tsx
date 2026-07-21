import { useState } from 'react';
import { Search as SearchIcon, CircleDot } from 'lucide-react';
import Page from '../components/Page';
import GuessInputBar from '../components/GuessInputBar';
import { PlayerInfoTable } from '../components/AnswerOverlay';
import { api, errMsg } from '../api/client';
import { PlayerInfo } from '../types';
import { toast } from '../components/Toast';

/** 查选手:底部输入 + 自动补全,选中后在上方展示选手卡片(原版布局) */
export default function Search() {
  const [player, setPlayer] = useState<PlayerInfo | null>(null);

  const lookup = async (nickname: string) => {
    try {
      const res = await api.get<PlayerInfo[]>('/players', {
        params: { search: nickname },
      });
      const exact =
        res.data.find((p) => p.nickname.toLowerCase() === nickname.toLowerCase()) ??
        res.data[0] ??
        null;
      setPlayer(exact);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Page
      title="选手查询"
      icon={<SearchIcon size={17} />}
      dock={
        <GuessInputBar
          onPick={(p) => void lookup(p.nickname)}
          placeholder="输入选手昵称(支持模糊搜索)..."
          buttonText="查询"
        />
      }
    >
      <div className="player-search-content">
        {player ? (
          <div className="card">
            <h3>
              <CircleDot size={15} color={player.isActive ? '#16a34a' : '#9aa3b2'} />
              {player.nickname}
              <span className="muted" style={{ fontWeight: 400 }}>
                {player.isActive ? '现役' : '退役'} · {player.age} 岁
              </span>
            </h3>
            <PlayerInfoTable
              answer={{
                nickname: player.nickname,
                team: player.team,
                nationality: `${player.nationality}(${player.region})`,
                role: player.role,
                majorChampionships: player.majorChampionships,
                majorAppearances: player.majorAppearances,
              }}
            />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-light)' }}>
            <SearchIcon size={32} strokeWidth={1.5} />
            <p>在下方输入框中输入选手名称即可查询</p>
            <p style={{ fontSize: '0.8rem' }}>支持模糊搜索:输入部分名称即可匹配</p>
          </div>
        )}
      </div>
    </Page>
  );
}
