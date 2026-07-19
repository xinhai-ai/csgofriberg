import { useEffect, useRef, useState } from 'react';
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
  EyeOff,
  Timer,
} from 'lucide-react';
import Page from '../components/Page';
import GuessBoard from '../components/GuessBoard';
import GuessInputBar from '../components/GuessInputBar';
import AnswerOverlay, { AnswerInfo } from '../components/AnswerOverlay';
import { getSocket } from '../api/socket';
import { translate } from '../i18n/messages';
import { MultiplayerGuessFeedback, RoomState, RoomPlayer } from '../types';
import { useConfirm } from '../components/ConfirmDialog';

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
function Countdown({ endsAt, onExpire }: { endsAt: number | null; onExpire?: () => void }) {
  const [left, setLeft] = useState(0);
  const expired = useRef(false);
  useEffect(() => {
    expired.current = false;
    if (!endsAt) {
      setLeft(0);
      return;
    }
    const tick = () => {
      const next = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setLeft(next);
      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpire?.();
      }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [endsAt, onExpire]);
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
  const [showRoomCode, setShowRoomCode] = useState(false);
  const [myKey, setMyKey] = useState('');
  const [roundExpired, setRoundExpired] = useState(false);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const roomRef = useRef<RoomState | null>(null);
  roomRef.current = room;

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
      setError('');
      setRoundExpired(false);
      setRoom(p.room);
    };
    const onRoundOver = (p: RoundOver & { room: RoomState }) => {
      setRoundExpired(true);
      setError('');
      setRoundOver(p);
      setRoom(p.room);
    };
    const onMatchOver = (p: MatchOver & { room: RoomState }) => {
      setRoundExpired(true);
      setError('');
      setRoundOver(null);
      setMatchOver(p);
      setRoom(p.room);
    };
    const onOffline = (p: { key: string; graceMs: number }) => {
      if (p.key !== myKey) {
        const name = roomRef.current?.players.find((player) => player.key === p.key)?.name ?? '对手';
        setOfflineNote(`${name} 已离线,${Math.round(p.graceMs / 1000)} 秒内未重连将判负`);
      }
    };
    const onRoomError = (p: { code: string }) => setError(translate(p.code));
    const onIdentity = (p: { key: string }) => setMyKey(p.key);
    const onGuessApplied = (p: {
      roundId: number;
      key: string;
      feedback: MultiplayerGuessFeedback;
    }) => {
      setRoom((current) => {
        if (!current || current.roundId !== p.roundId) return current;
        const feedback = p.feedback;
        return {
          ...current,
          players: current.players.map((player) => {
            if (player.key !== p.key) return player;
            const duplicate = !('hidden' in feedback) && player.guesses.some(
              (guess) => !('hidden' in guess) && guess.playerId === feedback.playerId
            );
            return duplicate
              ? player
              : {
                  ...player,
                  guesses: [...player.guesses, feedback],
                  guessCount: player.guessCount + 1,
                };
          }),
        };
      });
    };
    socket.on('room:state', onState);
    socket.on('round:start', onRoundStart);
    socket.on('round:over', onRoundOver);
    socket.on('match:over', onMatchOver);
    socket.on('player:offline', onOffline);
    socket.on('room:error', onRoomError);
    socket.on('game:guess:applied', onGuessApplied);
    socket.on('identity:self', onIdentity);

    // 关闭/刷新页面时立刻断开 socket,让对手第一时间收到离线通知
    const onPageHide = () => socket.disconnect();
    // 切回页面(含 bfcache 恢复/移动端切回)时重连并重新同步房间状态
    const resync = () => {
      const s = getSocket(); // 内部会对手动断开的 socket 执行 connect()
      s.emit('room:sync', {}, (res: any) => {
        if (res?.selfKey) setMyKey(res.selfKey);
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
      if (res?.selfKey) setMyKey(res.selfKey);
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
      socket.off('game:guess:applied', onGuessApplied);
      socket.off('identity:self', onIdentity);
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

  const submitGuess = (playerId: number): Promise<void> => new Promise((resolve) => {
    const current = roomRef.current;
    if (!current || current.status !== 'playing' || roundExpired) return resolve();
    const socket = getSocket();
    const timer = window.setTimeout(() => {
      setError(translate('NETWORK_ERROR'));
      resolve();
    }, 5_000);
    socket.emit('game:guess', {
      playerId,
      roundId: current.roundId,
      eventId: crypto.randomUUID(),
    }, (res: any) => {
      window.clearTimeout(timer);
      if (res?.room) setRoom(res.room);
      if (res?.code === 'NO_ACTIVE_ROUND' || res?.code === 'STALE_ROUND') {
        setError('');
        socket.emit('room:sync', {}, (sync: any) => {
          if (sync?.room) setRoom(sync.room);
          resolve();
        });
        return;
      }
      if (res?.code) setError(translate(res.code));
      resolve();
    });
  });

  const leaveRoom = async () => {
    const currentRoom = room;
    if (!currentRoom) return;
    const isCurrentSpectator = !currentRoom.players.some((player) => player.key === myKey);
    const matchOngoing =
      !isCurrentSpectator &&
      (currentRoom.status === 'playing' || currentRoom.status === 'round_over');
    if (matchOngoing && !await confirm({
      title: '离开当前比赛?',
      message: '比赛尚未结束，现在离开会被判负。',
      confirmLabel: '离开并判负',
      tone: 'danger',
    })) return;
    emit('room:leave');
    navigate('/multi');
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
      title={`多人房间 · BO${room.boType}`}
      icon={<Globe size={17} />}
      actions={
        <div className="room-actions">
          <button
            type="button"
            className="room-code-toggle"
            onClick={() => setShowRoomCode((visible) => !visible)}
            title={showRoomCode ? '隐藏房间码' : '显示房间码'}
            aria-label={showRoomCode ? '隐藏房间码' : '显示房间码'}
            aria-pressed={showRoomCode}
          >
            {showRoomCode ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{showRoomCode ? room.id : '•••••'}</span>
          </button>
          <button
            className="btn btn-danger btn-sm"
            aria-label={isSpectator ? '退出观战' : '离开房间'}
            onClick={() => void leaveRoom()}
          >
            <DoorOpen size={15} />
            <span className="btn-text">{isSpectator ? '退出观战' : '离开房间'}</span>
          </button>
        </div>
      }
      statusBar={
        <>
          <Swords size={15} />
          {room.status === 'waiting'
            ? `等待开始 · ${room.dbType === 'normal' ? '完整版' : '简单版'}数据库 · ${room.winsNeeded} 胜制`
            : `第 ${room.round} 局 · 先胜 ${room.winsNeeded} 局`}
          {playing && <Countdown endsAt={room.roundEndsAt} onExpire={() => setRoundExpired(true)} />}
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
            onPick={(p) => submitGuess(p.id)}
            disabled={roundExpired || me.guessCount >= room.maxGuesses}
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
              className="room-player-row"
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
            <p className="muted">等待对手加入</p>
          )}
          {!isSpectator && (
            <div className="room-ready-actions">
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
