import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe,
  Crown,
  WifiOff,
  Check,
  Hourglass,
  Swords,
  DoorOpen,
  Play,
  Eye,
  Timer,
} from 'lucide-react';
import Page from '../components/Page';
import GuessBoard from '../components/GuessBoard';
import GuessInputBar from '../components/GuessInputBar';
import AnswerOverlay, { AnswerInfo } from '../components/AnswerOverlay';
import { getSocket } from '../api/socket';
import { translate } from '../i18n/messages';
import { useAuth } from '../store/auth';
import { getGuestKey } from '../store/guest';
import { RoomState, RoomPlayer } from '../types';

interface RoundOver {
  winnerKey: string | null;
  reason: string;
  answer: AnswerInfo | null;
  matchOver: boolean;
  nextRoundInMs?: number;
}

interface MatchOver {
  winnerKey: string | null;
  reason: string;
  answer: AnswerInfo | null;
}

const MATCH_OVER_REASON: Record<string, string> = {
  score: '率先拿下赛点',
  opponent_left: '对手退出了房间',
  disconnect_timeout: '对手断线超时',
};

const ROUND_OVER_REASON: Record<string, string> = {
  guessed: '猜中目标',
  exhausted: '双方次数用尽',
  timeout: '本局时间到',
};

/** 每局倒计时,从服务端下发的截止时间戳换算 */
function Countdown({ endsAt }: { endsAt: number | null }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className={`countdown ${left <= 15 ? 'urgent' : ''}`}>
      <Timer size={15} />
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

function PlayerBoard({
  player,
  room,
  title,
}: {
  player: RoomPlayer;
  room: RoomState;
  title: string;
}) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <h3>
        {title}
        <span className="muted" style={{ fontWeight: 400 }}>
          {player.guessCount}/{room.maxGuesses}
        </span>
        {!player.connected && (
          <span className="badge red">
            <WifiOff size={12} />
            已离线
          </span>
        )}
      </h3>
      {player.guesses.length ? (
        <GuessBoard guesses={player.guesses} />
      ) : (
        <p className="muted">尚未猜测</p>
      )}
    </div>
  );
}

export default function MultiRoom() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roundOver, setRoundOver] = useState<RoundOver | null>(null);
  const [matchOver, setMatchOver] = useState<MatchOver | null>(null);
  const [offlineNote, setOfflineNote] = useState('');
  const [error, setError] = useState('');
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const roomRef = useRef<RoomState | null>(null);
  roomRef.current = room;

  const myKey = useMemo(
    () => (user ? `u:${user.id}` : `g:${getGuestKey()}`),
    [user]
  );

  useEffect(() => {
    const socket = getSocket();
    const onState = (state: RoomState) => {
      setRoom(state);
      // 所有玩家都在线时清除离线提示(对手已重连)
      if (state.players.every((p) => p.connected)) setOfflineNote('');
    };
    const onRoundStart = (p: { room: RoomState }) => {
      setRoundOver(null);
      setOfflineNote('');
      setRoom(p.room);
    };
    const onRoundOver = (p: RoundOver & { room: RoomState }) => {
      setRoundOver(p);
      setRoom(p.room);
    };
    const onMatchOver = (p: MatchOver & { room: RoomState }) => {
      setRoundOver(null);
      setMatchOver(p);
      setRoom(p.room);
    };
    const onOffline = (p: { key: string; name: string; graceMs: number }) => {
      if (p.key !== myKey) {
        setOfflineNote(`${p.name} 已离线,${Math.round(p.graceMs / 1000)} 秒内未重连将判负`);
      }
    };
    const onRoomError = (p: { code: string }) => setError(translate(p.code));
    socket.on('room:state', onState);
    socket.on('round:start', onRoundStart);
    socket.on('round:over', onRoundOver);
    socket.on('match:over', onMatchOver);
    socket.on('player:offline', onOffline);
    socket.on('room:error', onRoomError);

    // 关闭/刷新页面时立刻断开 socket,让对手第一时间收到离线通知
    const onPageHide = () => socket.disconnect();
    // 切回页面(含 bfcache 恢复/移动端切回)时重连并重新同步房间状态
    const resync = () => {
      const s = getSocket(); // 内部会对手动断开的 socket 执行 connect()
      s.emit('room:sync', {}, (res: any) => {
        if (res?.room) setRoom(res.room);
      });
    };
    const onPageShow = () => resync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    // socket 层重连成功后也刷新一次(如网络闪断自动恢复)
    socket.io.on('reconnect', resync);

    // 主动向服务端同步一次房间状态;确认不在任何房间才回大厅
    socket.emit('room:sync', {}, (res: any) => {
      if (res?.room) setRoom(res.room);
      else if (!roomRef.current) navigate('/multi');
    });
    return () => {
      socket.off('room:state', onState);
      socket.off('round:start', onRoundStart);
      socket.off('round:over', onRoundOver);
      socket.off('match:over', onMatchOver);
      socket.off('player:offline', onOffline);
      socket.off('room:error', onRoomError);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
      socket.io.off('reconnect', resync);
    };
  }, [navigate, myKey]);

  const emit = (event: string, payload: unknown = {}) => {
    setError('');
    getSocket().emit(event, payload, (res: any) => {
      if (res?.code) setError(translate(res.code));
      if (res?.room) setRoom(res.room);
    });
  };

  const me = room?.players.find((p) => p.key === myKey);
  const opponent = room?.players.find((p) => p.key !== myKey);
  const isSpectator = !!room && !me;
  const isHost = room?.hostKey === myKey;
  const playing = room?.status === 'playing';

  if (!room) {
    return (
      <Page title="多人房间" icon={<Globe size={17} />}>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div className="spinner" />
          <p className="muted">正在获取房间状态...</p>
        </div>
      </Page>
    );
  }

  const leftPlayer = me ?? room.players[0];
  const rightPlayer = me ? opponent : room.players[1];

  return (
    <Page
      title={`房间 ${room.id} · BO${room.boType}`}
      icon={<Globe size={17} />}
      actions={
        <button
          className="btn btn-danger btn-sm"
          onClick={() => {
            // 对局尚未结束时,玩家离开会被判负,需要二次确认
            const matchOngoing =
              !isSpectator && (room.status === 'playing' || room.status === 'round_over');
            if (matchOngoing && !window.confirm('比赛尚未结束,现在离开将被判负。确定要离开吗?')) {
              return;
            }
            emit('room:leave');
            navigate('/multi');
          }}
        >
          <DoorOpen size={15} />
          <span className="btn-text">{isSpectator ? '退出观战' : '离开房间'}</span>
        </button>
      }
      statusBar={
        <>
          <Swords size={15} />
          {room.status === 'waiting'
            ? `等待开始 · ${room.dbType === 'normal' ? '完整版' : '简单版'}数据库 · ${room.winsNeeded} 胜制`
            : `第 ${room.round} 局 · 先胜 ${room.winsNeeded} 局`}
          {playing && <Countdown endsAt={room.roundEndsAt} />}
          {isSpectator && (
            <span className="badge">
              <Eye size={12} />
              观战中
            </span>
          )}
          {room.spectators.length > 0 && (
            <span className="muted">
              <Eye size={12} style={{ verticalAlign: -2 }} /> {room.spectators.length} 人观战
            </span>
          )}
          {offlineNote && <span className="error">{offlineNote}</span>}
          {error && <span className="error">{error}</span>}
        </>
      }
      dock={
        playing && me ? (
          <GuessInputBar
            onPick={(p) => emit('game:guess', { playerId: p.id })}
            disabled={me.guessCount >= room.maxGuesses}
          />
        ) : undefined
      }
    >
      {/* 比分栏 */}
      <div className="card score-bar">
        <span className="player-name">
          {leftPlayer?.key === room.hostKey && <Crown size={16} color="var(--warning)" />}
          {leftPlayer?.name ?? '-'}
        </span>
        <span className="score">
          {leftPlayer?.score ?? 0} : {rightPlayer?.score ?? 0}
        </span>
        <span className="player-name">
          {rightPlayer?.key === room.hostKey && <Crown size={16} color="var(--warning)" />}
          {rightPlayer?.name ?? '等待加入'}
        </span>
      </div>

      {/* 等待区 */}
      {room.status === 'waiting' && (
        <div className="card">
          {room.players.map((p) => (
            <div
              key={p.key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}
            >
              <b>{p.name}</b>
              {p.key === room.hostKey && <Crown size={15} color="var(--warning)" />}
              {!p.connected && (
                <span className="badge red">
                  <WifiOff size={12} />
                  离线
                </span>
              )}
              {p.ready ? (
                <span className="badge green">
                  <Check size={12} />
                  已准备
                </span>
              ) : (
                <span className="badge amber">
                  <Hourglass size={12} />
                  未准备
                </span>
              )}
            </div>
          ))}
          {room.players.length < 2 && (
            <p className="muted">等待对手加入,房间码 {room.id}</p>
          )}
          {!isSpectator && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              {isHost ? (
                <button
                  className="btn btn-success"
                  onClick={() => emit('game:start')}
                  disabled={room.players.length < 2 || !room.players.every((p) => p.ready)}
                >
                  <Play size={16} />
                  开始对局
                </button>
              ) : (
                <button className="btn btn-success" onClick={() => emit('room:ready')}>
                  <Check size={16} />
                  {me?.ready ? '取消准备' : '准备'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 对局区:左右分栏(移动端上下堆叠) */}
      {room.status !== 'waiting' && (
        <div className="boards">
          {leftPlayer && (
            <PlayerBoard
              player={leftPlayer}
              room={room}
              title={me ? '我的猜测' : leftPlayer.name}
            />
          )}
          {rightPlayer && (
            <PlayerBoard player={rightPlayer} room={room} title={rightPlayer.name} />
          )}
        </div>
      )}

      {/* 小局结算 */}
      {roundOver && !matchOver && (
        <AnswerOverlay
          title={
            roundOver.winnerKey == null
              ? '本局平局'
              : roundOver.winnerKey === myKey
                ? '本局获胜'
                : isSpectator
                  ? `${room.players.find((p) => p.key === roundOver.winnerKey)?.name ?? ''} 拿下本局`
                  : '本局失利'
          }
          answer={roundOver.answer}
          extra={
            <p className="muted">
              {ROUND_OVER_REASON[roundOver.reason] ?? ''} · 下一局即将自动开始
            </p>
          }
          actions={
            <button className="btn btn-ghost" onClick={() => setRoundOver(null)}>
              查看棋盘
            </button>
          }
        />
      )}

      {/* 整场结算 */}
      {matchOver && (
        <AnswerOverlay
          title={
            matchOver.winnerKey == null
              ? '比赛结束'
              : isSpectator
                ? `${room.players.find((p) => p.key === matchOver.winnerKey)?.name ?? ''} 获胜`
                : matchOver.winnerKey === myKey
                  ? '你赢下了整场比赛'
                  : '你输掉了比赛'
          }
          answer={matchOver.answer}
          extra={
            <p className="muted">
              {MATCH_OVER_REASON[matchOver.reason] ?? matchOver.reason} · 最终比分{' '}
              {leftPlayer?.score ?? 0} : {rightPlayer?.score ?? 0}
            </p>
          }
          actions={
            <button className="btn" onClick={() => navigate('/multi')}>
              返回大厅
            </button>
          }
        />
      )}
    </Page>
  );
}
