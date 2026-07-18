import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Gamepad2, Flame, RotateCcw, Lightbulb, Target, X, Home } from 'lucide-react';
import Page from '../components/Page';
import GuessBoard from '../components/GuessBoard';
import GuessInputBar from '../components/GuessInputBar';
import AnswerOverlay, { AnswerInfo } from '../components/AnswerOverlay';
import { api, errMsg } from '../api/client';
import { GuessFeedback } from '../types';

function exitGame(gameId: string): Promise<unknown> {
  return api.post(`/game/${gameId}/exit`);
}

export default function SingleGame() {
  const { mode = 'easy' } = useParams();
  const navigate = useNavigate();
  const [gameId, setGameId] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessFeedback[]>([]);
  const [maxGuesses, setMaxGuesses] = useState(8);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [answer, setAnswer] = useState<AnswerInfo | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [error, setError] = useState('');
  const gameIdRef = useRef<string | null>(null);

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

  const leave = async () => {
    const id = gameIdRef.current;
    setCurrentGameId(null);
    if (id && status === 'playing') await exitGame(id);
    navigate('/');
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
      title={isEasy ? '单人 · 简单版' : '单人 · 完整版'}
      icon={isEasy ? <Gamepad2 size={17} /> : <Flame size={17} />}
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => void start(true)}>
            <RotateCcw size={15} />
            <span className="btn-text">重新开始</span>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void leave()}>
            <Home size={15} />
            <span className="btn-text">主菜单</span>
          </button>
          <button
            className="btn btn-warning btn-sm"
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
            <button className="btn" onClick={() => void start(true)}>
              <RotateCcw size={15} />
              再来一把
            </button>
            <button className="btn btn-danger" onClick={() => void leave()}>
              <X size={15} />
              返回菜单
            </button>
          </div>
        ) : (
          <GuessInputBar onPick={(p) => void guess(p.id)} />
        )
      }
    >
      {guesses.length ? (
        <GuessBoard guesses={guesses} />
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
              <button className="btn" onClick={() => void start(true)}>
                <RotateCcw size={15} />
                再来一把
              </button>
              <button className="btn btn-ghost" onClick={() => setShowOverlay(false)}>
                查看棋盘
              </button>
            </>
          }
        />
      )}
    </Page>
  );
}
