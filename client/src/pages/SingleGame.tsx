import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Gamepad2, Flame, RotateCcw, Lightbulb, Target, X, Home } from 'lucide-react';
import Page from '../components/Page';
import GuessBoard from '../components/GuessBoard';
import GuessInputBar from '../components/GuessInputBar';
import AnswerOverlay, { AnswerInfo } from '../components/AnswerOverlay';
import { api, errMsg } from '../api/client';
import { GuessFeedback } from '../types';
import { useConfirm } from '../components/ConfirmDialog';

function exitGame(gameId: string): Promise<unknown> {
  return api.post(`/game/${gameId}/exit`);
}

export default function SingleGame() {
  const { mode = 'easy' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [gameId, setGameId] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessFeedback[]>([]);
  const [maxGuesses, setMaxGuesses] = useState(8);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [answer, setAnswer] = useState<AnswerInfo | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [error, setError] = useState('');
  const gameIdRef = useRef<string | null>(null);
  const boardEndRef = useRef<HTMLDivElement>(null);

  const setCurrentGameId = (id: string | null) => {
    gameIdRef.current = id;
    setGameId(id);
  };

  const start = useCallback(async (replace = true) => {
    setError('');
    setAnswer(null);
    setShowOverlay(false);
    setStatus('playing');
    try {
      const previous = gameIdRef.current;
      if (replace && previous) {
        setCurrentGameId(null);
        await exitGame(previous);
      }
      const res = await api.post('/game/start', { mode });
      setCurrentGameId(String(res.data.gameId));
      setGuesses(res.data.guesses);
      setMaxGuesses(res.data.maxGuesses);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [mode]);

  useEffect(() => {
    void start(false);
  }, [start]);

  useEffect(() => {
    if (!inputFocused || !window.matchMedia('(max-width: 640px)').matches) return;
    let frame = 0;
    const keepLatestVisible = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        boardEndRef.current?.scrollIntoView({ block: 'end' });
      });
    };
    keepLatestVisible();
    window.visualViewport?.addEventListener('resize', keepLatestVisible);
    return () => {
      window.cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', keepLatestVisible);
    };
  }, [guesses.length, inputFocused]);

  const leave = async () => {
    const isGameActive = Boolean(gameIdRef.current) && status === 'playing';
    if (isGameActive && !await confirm({
      title: '返回主菜单?',
      message: '当前游戏进度会被清除，返回后无法继续本局。',
      confirmLabel: '返回主菜单',
      tone: 'danger',
    })) return;
    const id = gameIdRef.current;
    setCurrentGameId(null);
    if (id && isGameActive) await exitGame(id);
    navigate('/');
  };

  const restart = async () => {
    const isGameActive = Boolean(gameIdRef.current) && status === 'playing';
    if (isGameActive && !await confirm({
      title: '重新开始?',
      message: '当前游戏进度会被清除，并立即生成一局新游戏。',
      confirmLabel: '重新开始',
      tone: 'danger',
    })) return;
    await start(true);
  };

  const guess = async (playerId: number) => {
    if (!gameId || status !== 'playing') return;
    setError('');
    try {
      const res = await api.post(`/game/${gameId}/guess`, { playerId });
      setGuesses((g) => [...g, res.data.feedback]);
      setStatus(res.data.status);
      if (res.data.answer) {
        setAnswer(res.data.answer);
        setShowOverlay(true);
      }
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const reveal = async () => {
    if (!gameId || status !== 'playing') return;
    if (!await confirm({
      title: '查看答案?',
      message: '查看答案会立即结束本局，并按失败结算。',
      confirmLabel: '查看答案',
      tone: 'danger',
    })) return;
    try {
      const res = await api.post(`/game/${gameId}/giveup`);
      setStatus('lost');
      if (res.data.answer) {
        setAnswer(res.data.answer);
        setShowOverlay(true);
      }
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const finished = status !== 'playing';
  const isEasy = mode === 'easy';

  return (
    <Page
      className={`game-page single-game-page${inputFocused ? ' keyboard-active' : ''}`}
      title={isEasy ? '单人 · 简单版' : '单人 · 完整版'}
      icon={isEasy ? <Gamepad2 size={17} /> : <Flame size={17} />}
      actions={
        <>
          <button className="btn btn-ghost btn-sm" aria-label="重新开始" onClick={() => void restart()}>
            <RotateCcw size={15} />
            <span className="btn-text">重新开始</span>
          </button>
          <button className="btn btn-ghost btn-sm" aria-label="返回主菜单" onClick={() => void leave()}>
            <Home size={15} />
            <span className="btn-text">主菜单</span>
          </button>
          <button
            className="btn btn-warning btn-sm"
            aria-label="查看答案"
            onClick={() => void reveal()}
            disabled={finished}
          >
            <Lightbulb size={15} />
            <span className="btn-text">查看答案</span>
          </button>
        </>
      }
      showHome={false}
      statusBar={
        <>
          <Target size={14} />
          猜测次数 {guesses.length} / {maxGuesses}
          <span style={{ color: 'var(--border)' }}>|</span>
          {finished
            ? status === 'won'
              ? '恭喜,猜对了'
              : '本局结束'
            : '绿色正确 · 黄色接近 · 箭头指示目标数值方向'}
          {error && <span className="error">{error}</span>}
        </>
      }
      dock={
        finished ? (
          <div className="input-bar" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => void restart()}>
              <RotateCcw size={15} />
              再来一把
            </button>
            <button className="btn btn-danger" onClick={() => void leave()}>
              <X size={15} />
              返回菜单
            </button>
          </div>
        ) : (
          <GuessInputBar
            onPick={(p) => void guess(p.id)}
            onFocusChange={setInputFocused}
          />
        )
      }
    >
      {guesses.length ? (
        <div className="single-game-board">
          <GuessBoard guesses={guesses} />
          <div ref={boardEndRef} className="guess-board-end" aria-hidden="true" />
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-light)' }}>
          <Target size={32} strokeWidth={1.5} />
          <p>在下方输入选手昵称开始猜测</p>
          {isEasy ? (
            <p style={{ fontSize: '0.8rem' }}>简单版:目标限定为知名度较高的选手</p>
          ) : (
            <p style={{ fontSize: '0.8rem' }}>完整版:目标可能是选手库中的任何人</p>
          )}
        </div>
      )}
      {showOverlay && (
        <AnswerOverlay
          title={status === 'won' ? '恭喜,猜对了' : '正确答案'}
          answer={answer}
          extra={
            <p className="muted">
              {status === 'won' ? `共用了 ${guesses.length} 次猜测` : '很遗憾,本局未能猜中'}
            </p>
          }
          actions={
            <>
              <button className="btn" onClick={() => void restart()}>
                <RotateCcw size={15} />
                再来一把
              </button>
              <button className="btn btn-ghost" onClick={() => setShowOverlay(false)}>
                查看对局
              </button>
            </>
          }
        />
      )}
    </Page>
  );
}
