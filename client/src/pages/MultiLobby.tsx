import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe,
  House,
  Dices,
  DoorOpen,
  Copy,
  Check,
  Zap,
  Rocket,
  XCircle,
  Eye,
} from 'lucide-react';
import Page from '../components/Page';
import { getSocket } from '../api/socket';
import { translate } from '../i18n/messages';
import { RoomState } from '../types';
import { useConfirm } from '../components/ConfirmDialog';

type DbType = 'easy' | 'normal';
const BO_OPTIONS = [1, 3, 5, 7];

function OptionGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className="option-row">
      <span className="opt-label">{label}</span>
      {options.map((opt) => (
        <button
          key={String(opt)}
          className={`opt-btn ${opt === value ? 'active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  );
}

export default function MultiLobby() {
  const [dbType, setDbType] = useState<DbType>('normal');
  const [boType, setBoType] = useState(3);
  const [allowSpectators, setAllowSpectators] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [mmDbType, setMmDbType] = useState<DbType>('normal');
  const [mmAnonymous, setMmAnonymous] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [createdRoom, setCreatedRoom] = useState<RoomState | null>(null);
  const [currentRoom, setCurrentRoom] = useState<RoomState | null>(null);
  const [currentRole, setCurrentRole] = useState<'player' | 'spectator'>('player');
  const [copied, setCopied] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const confirm = useConfirm();
  const searchingRef = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    const onMatchFound = () => {
      searchingRef.current = false;
      navigate('/multi/room');
    };
    socket.on('match:found', onMatchFound);
    // 查询自己是否还挂在某个房间里(断线重进/误退出场景)
    socket.emit('room:sync', {}, (res: any) => {
      if (res?.room) {
        setCurrentRoom(res.room);
        setCurrentRole(res.role ?? 'player');
      }
    });
    return () => {
      socket.off('match:found', onMatchFound);
      // 离开大厅时取消排队
      if (searchingRef.current) socket.emit('match:cancel', {});
    };
  }, [navigate]);

  /** 结束比赛/退出观战:对局中离开即判负,需二次确认 */
  const endCurrent = async () => {
    const matchOngoing =
      currentRole === 'player' &&
      (currentRoom?.status === 'playing' || currentRoom?.status === 'round_over');
    if (matchOngoing && !await confirm({
      title: '结束当前比赛?',
      message: '比赛尚未结束，现在退出会被判负。',
      confirmLabel: '结束并判负',
      tone: 'danger',
    })) return;
    getSocket().emit('room:leave', {}, () => {
      setCurrentRoom(null);
    });
  };

  const create = () => {
    setError('');
    getSocket().emit('room:create', { dbType, boType, allowSpectators, anonymous }, (res: any) => {
      if (res?.code) return setError(translate(res.code));
      setCreatedRoom(res.room);
    });
  };

  const join = (code: string, spectate = false) => {
    setError('');
    if (!code.trim()) return;
    getSocket().emit('room:join', { roomId: code.trim(), spectate }, (res: any) => {
      if (res?.code) return setError(translate(res.code));
      navigate('/multi/room');
    });
  };

  const startMatch = () => {
    setError('');
    getSocket().emit('match:start', { dbType: mmDbType, anonymous: mmAnonymous }, (res: any) => {
      if (res?.code) {
        setSearching(false);
        searchingRef.current = false;
        return setError(translate(res.code));
      }
      if (res?.queued) {
        setSearching(true);
        searchingRef.current = true;
      }
      // queued=false 时 match:found 事件会直接跳转
    });
  };

  const cancelMatch = () => {
    getSocket().emit('match:cancel', {}, () => {
      setSearching(false);
      searchingRef.current = false;
    });
  };

  const copyCode = async () => {
    if (!createdRoom) return;
    try {
      await navigator.clipboard.writeText(createdRoom.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* http 环境下降级:房间码本身可长按选中复制 */
    }
  };

  return (
    <Page title="多人联机" icon={<Globe size={17} />}>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <span className="error">{error}</span>
        </div>
      )}

      {currentRoom && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <h3>
            <Rocket size={16} color="var(--warning)" />
            你有一场未结束的对局
          </h3>
          <p className="muted">
            房间 {currentRoom.id} · BO{currentRoom.boType} ·{' '}
            {currentRoom.status === 'waiting'
              ? '等待开始'
              : currentRoom.status === 'finished'
                ? '已结束'
                : `第 ${currentRoom.round} 局进行中`}
            {currentRole === 'spectator' && ' · 观战身份'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-success" onClick={() => navigate('/multi/room')}>
              <Rocket size={15} />
              重连进入
            </button>
            <button className="btn btn-danger" onClick={() => void endCurrent()}>
              <XCircle size={15} />
              {currentRole === 'spectator'
                ? '退出观战'
                : currentRoom.status === 'waiting'
                  ? '退出房间'
                  : '结束比赛(判负)'}
            </button>
          </div>
        </div>
      )}

      {createdRoom ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ justifyContent: 'center' }}>
            <Check size={16} color="var(--success)" />
            房间已创建
          </h3>
          <p className="muted">将以下房间码分享给对手:</p>
          <div className="room-code-display">{createdRoom.id}</div>
          <button className="btn btn-accent" onClick={() => void copyCode()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? '已复制' : '复制房间码'}
          </button>
          <p className="muted" style={{ margin: '10px 0' }}>
            数据库:{createdRoom.dbType === 'normal' ? '完整版' : '简单版'} · 赛制:BO
            {createdRoom.boType} · {createdRoom.allowSpectators ? '允许观战' : '禁止观战'}
            {' · '}{createdRoom.anonymous ? '匿名房间' : '显示玩家名'}
          </p>
          <button className="btn btn-lg" onClick={() => navigate('/multi/room')}>
            <Rocket size={16} />
            进入房间
          </button>
        </div>
      ) : (
        <div className="lobby-grid">
          <div className="card" style={{ margin: 0 }}>
            <h3>
              <House size={16} />
              创建房间
            </h3>
            <OptionGroup
              label="选手数据库"
              options={['normal', 'easy'] as DbType[]}
              value={dbType}
              onChange={setDbType}
              format={(v) => (v === 'normal' ? '完整版' : '简单版')}
            />
            <OptionGroup
              label="赛制"
              options={BO_OPTIONS}
              value={boType}
              onChange={setBoType}
              format={(v) => `BO${v}`}
            />
            <label className="spectator-option">
              <input
                type="checkbox"
                checked={allowSpectators}
                onChange={(event) => setAllowSpectators(event.target.checked)}
              />
              <span>允许观战</span>
            </label>
            <label className="spectator-option">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              <span>匿名房间</span>
            </label>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button className="btn btn-lg" onClick={create}>
                <Zap size={16} />
                创建房间
              </button>
            </div>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <h3>
              <Dices size={16} />
              随机匹配
            </h3>
            <p className="muted">自动寻找对手,赛制固定为 BO3</p>
            <OptionGroup
              label="选手数据库"
              options={['normal', 'easy'] as DbType[]}
              value={mmDbType}
              onChange={setMmDbType}
              format={(v) => (v === 'normal' ? '完整版' : '简单版')}
            />
            <label className="spectator-option">
              <input
                type="checkbox"
                checked={mmAnonymous}
                disabled={searching}
                onChange={(event) => setMmAnonymous(event.target.checked)}
              />
              <span>匿名匹配</span>
            </label>
            {searching ? (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <div className="spinner" />
                <p style={{ margin: '12px 0', fontWeight: 600 }}>正在寻找对手...</p>
                <button className="btn btn-ghost btn-sm" onClick={cancelMatch}>
                  <XCircle size={15} />
                  取消匹配
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button className="btn btn-accent btn-lg" onClick={startMatch}>
                  <Dices size={16} />
                  开始匹配
                </button>
              </div>
            )}
          </div>

          <div className="card" style={{ margin: 0 }}>
            <h3>
              <DoorOpen size={16} />
              加入已有房间
            </h3>
            <p className="muted">输入房间码后按回车加入</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                className="input"
                placeholder="5 位房间码"
                value={joinCode}
                maxLength={5}
                autoComplete="off"
                style={{
                  maxWidth: 180,
                  textAlign: 'center',
                  fontFamily: 'Consolas, monospace',
                  fontWeight: 700,
                  fontSize: '1.1rem',
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                }}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join(joinCode)}
              />
              <button className="btn btn-success" onClick={() => join(joinCode)}>
                <DoorOpen size={15} />
                加入
              </button>
              <button className="btn btn-ghost" onClick={() => join(joinCode, true)}>
                <Eye size={15} />
                观战
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
