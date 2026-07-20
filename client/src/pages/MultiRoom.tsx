import { Ref, useCallback, useEffect, useRef, useState } from 'react';
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
  Flag,
  RotateCcw,
  X,
} from 'lucide-react';
import Page from '../components/Page';
import GuessBoard from '../components/GuessBoard';
import GuessInputBar from '../components/GuessInputBar';
import AnswerOverlay, { AnswerInfo } from '../components/AnswerOverlay';
import { getSocket } from '../api/socket';
import { translate } from '../i18n/messages';
import { MultiplayerGuessFeedback, RoomPatch, RoomState, RoomPlayer } from '../types';
import { useConfirm } from '../components/ConfirmDialog';

interface RoundOver {
  winnerKey: string | null;
  reason: string;
  answer: AnswerInfo | null;
}

interface MatchOver {
  winnerKey: string | null;
  reason: string;
  answer: AnswerInfo | null;
}

const MULTI_GUESS_INTERVAL_MS = 3_000;

function applyRoomPatchState(current: RoomState, patch: RoomPatch): RoomState {
  const removedPlayers = new Set(patch.players?.removed ?? []);
  let players = current.players
    .filter((player) => !removedPlayers.has(player.key))
    .map((player) => {
      const update = patch.players?.updated?.find((candidate) => candidate.key === player.key);
      return update ? { ...player, ...update } : player;
    });
  for (const added of patch.players?.added ?? []) {
    const index = players.findIndex((player) => player.key === added.key);
    if (index >= 0) players[index] = added;
    else players = [...players, added];
  }

  return {
    ...current,
    stateVersion: patch.stateVersion,
    hostKey: patch.hostKey ?? current.hostKey,
    players,
    spectatorCount: patch.spectatorCount ?? current.spectatorCount,
  };
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
  surrender: '一方选择本轮投降',
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
  isSelf = false,
  boardRef,
}: {
  player: RoomPlayer;
  room: RoomState;
  title: string;
  isSelf?: boolean;
  boardRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={boardRef}
      className={`card player-board${isSelf ? ' player-board-self' : ' player-board-opponent'}`}
      style={{ margin: 0 }}
    >
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
  const [surrendering, setSurrendering] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchNotice, setRematchNotice] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [guessCooldownUntil, setGuessCooldownUntil] = useState(0);
  const [cooldownClock, setCooldownClock] = useState(() => Date.now());
  const navigate = useNavigate();
  const confirm = useConfirm();
  const roomRef = useRef<RoomState | null>(null);
  const myKeyRef = useRef('');
  const syncSequenceRef = useRef(0);
  const ownBoardRef = useRef<HTMLDivElement>(null);
  roomRef.current = room;
  myKeyRef.current = myKey;

  const applyRoomSnapshot = useCallback((state: RoomState, authoritative = false) => {
    const current = roomRef.current;
    if (!authoritative && (!current || state.id !== current.id)) return;
    if (current && state.id === current.id && state.stateVersion < current.stateVersion) return;
    roomRef.current = state;
    setRoom(state);
    setRoundExpired(state.status !== 'playing');
    setRoundOver(state.matchResult ? null : state.roundResult);
    setMatchOver(state.matchResult);
    if (state.players.every((player) => player.connected)) setOfflineNote('');
  }, []);

  const syncRoom = useCallback((socket = getSocket()) => {
    const sequence = ++syncSequenceRef.current;
    socket.emit('room:sync', {}, (res: any) => {
      if (sequence !== syncSequenceRef.current) return;
      if (res?.selfKey) setMyKey(res.selfKey);
      if (res?.room) applyRoomSnapshot(res.room, true);
    });
  }, [applyRoomSnapshot]);

  useEffect(() => {
    const socket = getSocket();
    const onPatch = (patch: RoomPatch) => {
      setRoom((current) => {
        if (!current || current.id !== patch.roomId) return current;
        if (patch.stateVersion <= current.stateVersion) return current;
        if (patch.baseVersion !== current.stateVersion) {
          syncRoom(socket);
          return current;
        }
        const next = applyRoomPatchState(current, patch);
        roomRef.current = next;
        if (next.players.every((player) => player.connected)) setOfflineNote('');
        return next;
      });
    };
    const onRoundStart = (p: { room: RoomState }) => {
      setGuessCooldownUntil(0);
      setRoundOver(null);
      setOfflineNote('');
      setError('');
      setRematchNotice('');
      setRoundExpired(false);
      applyRoomSnapshot(p.room);
    };
    const onRoundOver = (p: { room: RoomState }) => {
      setGuessCooldownUntil(0);
      setRoundExpired(true);
      setError('');
      applyRoomSnapshot(p.room);
    };
    const onMatchOver = (p: { room: RoomState }) => {
      setGuessCooldownUntil(0);
      setRoundExpired(true);
      setError('');
      setRoundOver(null);
      setRematchNotice('');
      applyRoomSnapshot(p.room);
    };
    const onRematchUpdate = (p: {
      roomId: string;
      stateVersion: number;
      outcome: 'invited' | 'cancelled' | 'declined' | 'accepted';
      actorKey: string;
      player?: { key: string; connected: boolean };
    }) => {
      setRoom((current) => {
        if (!current || current.id !== p.roomId) return current;
        if (p.stateVersion <= current.stateVersion) return current;
        if (p.stateVersion !== current.stateVersion + 1) {
          syncRoom(socket);
          return current;
        }
        const next: RoomState = p.outcome === 'accepted'
          ? {
              ...current,
              status: 'waiting',
              round: 0,
              roundId: 0,
              roundEndsAt: null,
              rematchInvite: null,
              roundResult: null,
              matchResult: null,
              players: current.players.map((player) => ({
                ...player,
                ready: player.key === current.hostKey,
                score: 0,
                guessCount: 0,
                guesses: [],
              })),
              stateVersion: p.stateVersion,
            }
          : {
              ...current,
              rematchInvite: p.outcome === 'invited'
                ? { inviterKey: p.actorKey }
                : null,
              players: p.player
                ? current.players.map((player) => player.key === p.player!.key
                  ? { ...player, connected: p.player!.connected }
                  : player)
                : current.players,
              stateVersion: p.stateVersion,
            };
        roomRef.current = next;
        return next;
      });
      if (p.outcome === 'accepted') {
        setGuessCooldownUntil(0);
        setRoundExpired(true);
        setRoundOver(null);
        setMatchOver(null);
        setOfflineNote('');
      }
      const actorIsMe = p.actorKey === myKeyRef.current;
      if (p.outcome === 'invited') {
        setRematchNotice(actorIsMe ? '已邀请对方再来一局' : '对方邀请你再来一局');
      } else if (p.outcome === 'cancelled') {
        setRematchNotice(actorIsMe ? '已取消邀请' : '对方取消了邀请');
      } else if (p.outcome === 'declined') {
        setRematchNotice(actorIsMe ? '已拒绝邀请' : '对方拒绝了邀请');
      } else {
        setRematchNotice(
          roomRef.current?.hostKey === myKeyRef.current
            ? '双方已同意，等待对方准备'
            : '双方已同意，请准备后等待房主开始'
        );
      }
    };
    const onOffline = (p: { key: string; graceMs: number }) => {
      if (p.key !== myKeyRef.current) {
        const name = roomRef.current?.players.find((player) => player.key === p.key)?.name ?? '对手';
        setOfflineNote(`${name} 已离线,${Math.round(p.graceMs / 1000)} 秒内未重连将判负`);
      }
    };
    const onRoomError = (p: { code: string }) => setError(translate(p.code));
    const onIdentity = (p: { key: string }) => setMyKey(p.key);
    const onGuessApplied = (p: {
      roomId: string;
      roundId: number;
      key: string;
      stateVersion: number;
      feedback: MultiplayerGuessFeedback;
    }) => {
      setRoom((current) => {
        if (!current || current.id !== p.roomId || current.roundId !== p.roundId) return current;
        if (p.stateVersion <= current.stateVersion) return current;
        if (p.stateVersion !== current.stateVersion + 1) {
          syncRoom(socket);
          return current;
        }
        const feedback = p.feedback;
        return {
          ...current,
          stateVersion: p.stateVersion,
          players: current.players.map((player) => {
            if (player.key !== p.key) return player;
            return {
              ...player,
              guesses: [...player.guesses, feedback],
              guessCount: player.guessCount + 1,
            };
          }),
        };
      });
    };
    socket.on('room:patch', onPatch);
    socket.on('round:start', onRoundStart);
    socket.on('round:over', onRoundOver);
    socket.on('match:over', onMatchOver);
    socket.on('match:rematch:update', onRematchUpdate);
    socket.on('player:offline', onOffline);
    socket.on('room:error', onRoomError);
    socket.on('game:guess:applied', onGuessApplied);
    socket.on('identity:self', onIdentity);

    // 关闭/刷新页面时立刻断开 socket,让对手第一时间收到离线通知
    const onPageHide = () => socket.disconnect();
    // 切回页面(含 bfcache 恢复/移动端切回)时重连并重新同步房间状态
    const resync = () => {
      const s = getSocket(); // 内部会对手动断开的 socket 执行 connect()
      syncRoom(s);
    };
    const onPageShow = () => resync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    // socket 层重连成功后也刷新一次(如网络闪断自动恢复)
    socket.on('connect', resync);

    // 主动向服务端同步一次房间状态;确认不在任何房间才回大厅
    const initialSequence = ++syncSequenceRef.current;
    socket.emit('room:sync', {}, (res: any) => {
      if (initialSequence !== syncSequenceRef.current) return;
      if (res?.selfKey) setMyKey(res.selfKey);
      if (res?.room) applyRoomSnapshot(res.room, true);
      else if (!roomRef.current) navigate('/multi');
    });
    return () => {
      socket.off('room:patch', onPatch);
      socket.off('round:start', onRoundStart);
      socket.off('round:over', onRoundOver);
      socket.off('match:over', onMatchOver);
      socket.off('match:rematch:update', onRematchUpdate);
      socket.off('player:offline', onOffline);
      socket.off('room:error', onRoomError);
      socket.off('game:guess:applied', onGuessApplied);
      socket.off('identity:self', onIdentity);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
      socket.off('connect', resync);
    };
  }, [applyRoomSnapshot, navigate, syncRoom]);

  useEffect(() => {
    if (!guessCooldownUntil) return;
    const tick = () => {
      const now = Date.now();
      setCooldownClock(now);
      if (now >= guessCooldownUntil) setGuessCooldownUntil(0);
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [guessCooldownUntil]);

  const emit = (event: string, payload: unknown = {}) => {
    setError('');
    getSocket().emit(event, payload, (res: any) => {
      if (res?.code) setError(translate(res.code));
      if (res?.room) applyRoomSnapshot(res.room);
    });
  };

  const submitGuess = (playerId: number): Promise<boolean> => new Promise((resolve) => {
    const current = roomRef.current;
    if (!current || current.status !== 'playing' || roundExpired) return resolve(false);
    const remaining = guessCooldownUntil - Date.now();
    if (remaining > 0) {
      setCooldownClock(Date.now());
      return resolve(false);
    }
    const socket = getSocket();
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return false;
      settled = true;
      resolve(accepted);
      return true;
    };
    const timer = window.setTimeout(() => {
      if (!finish(false)) return;
      setError(translate('NETWORK_ERROR'));
      syncRoom(socket);
    }, 5_000);
    socket.emit('game:guess', {
      playerId,
      roundId: current.roundId,
      eventId: crypto.randomUUID(),
    }, (res: any) => {
      if (settled) return;
      window.clearTimeout(timer);
      if (res?.room) applyRoomSnapshot(res.room);
      if (res?.code === 'GUESS_COOLDOWN') {
        setError('');
        setGuessCooldownUntil(Date.now() + Math.max(0, Number(res.retryAfterMs) || 0));
        finish(false);
        return;
      }
      if (res?.code === 'NO_ACTIVE_ROUND' || res?.code === 'STALE_ROUND') {
        setError('');
        syncRoom(socket);
        finish(false);
        return;
      }
      if (res?.code === 'ROOM_BUSY') {
        setError('');
        syncRoom(socket);
        finish(false);
        return;
      }
      if (res?.code) {
        setError(translate(res.code));
        finish(false);
        return;
      }
      setError('');
      setGuessCooldownUntil(Date.now() + Math.max(
        MULTI_GUESS_INTERVAL_MS,
        Number(res?.cooldownMs) || 0
      ));
      finish(true);
    });
  });

  const leaveRoom = async () => {
    const currentRoom = room;
    if (!currentRoom || leaving) return;
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
    setError('');
    setLeaving(true);
    const socket = getSocket();
    const result = await new Promise<any>((resolve) => {
      let settled = false;
      const finish = (value: any) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = window.setTimeout(() => finish({ code: 'NETWORK_ERROR' }), 5_000);
      socket.emit('room:leave', {}, (res: any) => {
        window.clearTimeout(timer);
        finish(res ?? { ok: true });
      });
    });
    if (result?.code) {
      setLeaving(false);
      setError(translate(result.code));
      return;
    }
    setRoom(null);
    roomRef.current = null;
    navigate('/multi');
  };

  const surrenderRound = async () => {
    const current = roomRef.current;
    if (!current || current.status !== 'playing' || surrendering) return;
    if (!await confirm({
      title: '投降本轮?',
      message: '投降后对手将立即获得本轮分数；如果对手达到赛点，整场比赛会直接结束。',
      confirmLabel: '确认投降本轮',
      tone: 'danger',
    })) return;
    setSurrendering(true);
    getSocket().emit('game:surrender-round', { roundId: current.roundId }, (res: any) => {
      setSurrendering(false);
      if (res?.room) applyRoomSnapshot(res.room);
      if (res?.code === 'NO_ACTIVE_ROUND' || res?.code === 'STALE_ROUND') {
        setError('');
        syncRoom();
        return;
      }
      if (res?.code) setError(translate(res.code));
    });
  };

  const updateRematch = (event: string, payload: unknown = {}) => {
    if (rematchBusy) return;
    setError('');
    setRematchBusy(true);
    const socket = getSocket();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setRematchBusy(false);
      setError(translate('NETWORK_ERROR'));
      syncRoom(socket);
    }, 5_000);
    socket.emit(event, payload, (res: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setRematchBusy(false);
      if (res?.code) setError(translate(res.code));
    });
  };

  const me = room?.players.find((p) => p.key === myKey);
  const opponent = room?.players.find((p) => p.key !== myKey);
  const isSpectator = !!room && !me;
  const isHost = room?.hostKey === myKey;
  const playing = room?.status === 'playing';
  const rematchInviterKey = room?.rematchInvite?.inviterKey ?? null;
  const canRematch = Boolean(
    room?.rematchAllowed &&
    room.status === 'finished' &&
    me &&
    room.players.length === 2 &&
    room.players.every((player) => player.connected)
  );
  const guessCooldownRemaining = Math.max(
    0,
    guessCooldownUntil - Math.max(cooldownClock, Date.now())
  );

  useEffect(() => {
    if (!inputFocused || !me || !window.matchMedia('(max-width: 640px)').matches) return;
    let frame = 0;
    const keepOwnBoardVisible = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        ownBoardRef.current?.scrollIntoView({ block: 'end' });
      });
    };
    keepOwnBoardVisible();
    window.visualViewport?.addEventListener('resize', keepOwnBoardVisible);
    return () => {
      window.cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', keepOwnBoardVisible);
    };
  }, [inputFocused, me?.guessCount, room?.roundId]);

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
      className={`game-page multi-game-page${inputFocused ? ' keyboard-active' : ''}`}
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
            disabled={leaving}
            onClick={() => void leaveRoom()}
          >
            <DoorOpen size={15} />
            <span className="btn-text">
              {leaving ? '退出中' : isSpectator ? '退出观战' : '离开房间'}
            </span>
          </button>
          {playing && me && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={roundExpired || surrendering}
              onClick={() => void surrenderRound()}
            >
              <Flag size={15} />
              <span className="btn-text">{surrendering ? '处理中' : '投降本轮'}</span>
            </button>
          )}
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
          {room.spectatorCount > 0 && (
            <span className="muted">
              <Eye size={12} style={{ verticalAlign: -2 }} /> {room.spectatorCount} 人观战
            </span>
          )}
          {offlineNote && <span className="error">{offlineNote}</span>}
          {rematchNotice && <span className="muted">{rematchNotice}</span>}
          {error && <span className="error">{error}</span>}
        </>
      }
      dock={
        playing && me ? (
          <GuessInputBar
            onPick={(p) => submitGuess(p.id)}
            onFocusChange={setInputFocused}
            statusText={guessCooldownRemaining > 0
              ? `猜测间隔：还需等待 ${(guessCooldownRemaining / 1000).toFixed(1)} 秒`
              : ''}
            disabled={roundExpired || me.guessCount >= room.maxGuesses}
          />
        ) : undefined
      }
    >
      {/* 比分栏 */}
      <div className="card score-bar">
        <span className="player-name score-bar-player-left">
          {leftPlayer?.key === room.hostKey && <Crown size={16} color="var(--warning)" />}
          {leftPlayer?.name ?? '-'}
        </span>
        <span className="score">
          {leftPlayer?.score ?? 0} : {rightPlayer?.score ?? 0}
        </span>
        <span className="player-name score-bar-player-right">
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
                <button
                  className="btn btn-success"
                  onClick={() => emit('room:ready', { ready: !me?.ready })}
                >
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
              isSelf={leftPlayer.key === myKey}
              boardRef={leftPlayer.key === myKey ? ownBoardRef : undefined}
            />
          )}
          {rightPlayer && (
            <PlayerBoard
              player={rightPlayer}
              room={room}
              title={rightPlayer.name}
              isSelf={rightPlayer.key === myKey}
              boardRef={rightPlayer.key === myKey ? ownBoardRef : undefined}
            />
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
              查看对局
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
            <div className="match-over-extra">
              <p className="muted">
                {MATCH_OVER_REASON[matchOver.reason] ?? matchOver.reason} · 最终比分{' '}
                {leftPlayer?.score ?? 0} : {rightPlayer?.score ?? 0}
              </p>
              {rematchNotice && <p className="muted">{rematchNotice}</p>}
            </div>
          }
          actions={
            <>
              {canRematch && !rematchInviterKey && (
                <button
                  className="btn btn-success"
                  disabled={rematchBusy}
                  onClick={() => updateRematch('match:rematch-invite')}
                >
                  <RotateCcw size={16} />
                  邀请再来一局
                </button>
              )}
              {canRematch && rematchInviterKey === myKey && (
                <button
                  className="btn btn-ghost"
                  disabled={rematchBusy}
                  onClick={() => updateRematch('match:rematch-cancel')}
                >
                  <X size={16} />
                  取消邀请
                </button>
              )}
              {canRematch && rematchInviterKey && rematchInviterKey !== myKey && (
                <>
                  <button
                    className="btn btn-success"
                    disabled={rematchBusy}
                    onClick={() => updateRematch('match:rematch-respond', { accept: true })}
                  >
                    <Check size={16} />
                    同意再来一局
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={rematchBusy}
                    onClick={() => updateRematch('match:rematch-respond', { accept: false })}
                  >
                    <X size={16} />
                    拒绝
                  </button>
                </>
              )}
              <button className="btn btn-ghost" disabled={leaving} onClick={() => void leaveRoom()}>
                <DoorOpen size={16} />
                {leaving ? '退出中' : '返回大厅'}
              </button>
            </>
          }
        />
      )}
    </Page>
  );
}
