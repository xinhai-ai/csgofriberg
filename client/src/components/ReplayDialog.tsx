import { useEffect, useId, useState } from 'react';
import { ChevronLeft, ChevronRight, Swords, User, X } from 'lucide-react';
import Badge from './Badge';
import GuessBoard from './GuessBoard';
import { PlayerInfoTable } from './AnswerOverlay';
import ModalPortal from './ModalPortal';
import type { GuessFeedback, PlayerInfo } from '../types';

export interface SingleReplay {
  type: 'single';
  id: number;
  mode: string;
  status: string;
  guessCount: number;
  createdAt: string;
  finishedAt: string;
  answer: PlayerInfo;
  guesses: GuessFeedback[];
}

export interface MultiReplayRound {
  round: number;
  reason: string;
  winner: 'me' | 'opponent' | null;
  answer: PlayerInfo;
  me: { guesses: GuessFeedback[] };
  opponent: { guesses: GuessFeedback[] };
}

export interface MultiReplay {
  type: 'multi';
  id: number;
  mode: string;
  boType: number;
  finishedAt: string;
  result: 'won' | 'lost' | 'draw';
  me: { score: number };
  opponent: { displayId: string; score: number };
  rounds: MultiReplayRound[];
}

export type Replay = SingleReplay | MultiReplay;

function formatMode(mode: string): string {
  return mode === 'easy' ? '简单' : '完整';
}

function formatMultiResult(result: MultiReplay['result']): string {
  return result === 'won' ? '胜利' : result === 'lost' ? '失败' : '平局';
}

function AnswerSection({ answer }: { answer: PlayerInfo }) {
  return (
    <section className="replay-answer" aria-label="正确答案">
      <h3>正确答案: {answer.nickname}</h3>
      <PlayerInfoTable
        answer={{
          nickname: answer.nickname,
          team: answer.team,
          nationality: `${answer.nationality}(${answer.region})`,
          role: answer.role,
          majorChampionships: answer.majorChampionships,
          majorAppearances: answer.majorAppearances,
        }}
      />
    </section>
  );
}

export default function ReplayDialog({ replay, onClose }: { replay: Replay; onClose: () => void }) {
  const titleId = useId();
  const [roundIndex, setRoundIndex] = useState(0);
  const roundCount = replay.type === 'multi' ? replay.rounds.length : 0;
  const activeRound = replay.type === 'multi' ? replay.rounds[roundIndex] : null;

  useEffect(() => {
    setRoundIndex(0);
  }, [replay.id, replay.type]);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (replay.type === 'multi' && replay.rounds.length > 0 && event.key === 'ArrowLeft') {
        setRoundIndex((current) => Math.max(0, current - 1));
      }
      if (replay.type === 'multi' && replay.rounds.length > 0 && event.key === 'ArrowRight') {
        setRoundIndex((current) => Math.min(replay.rounds.length - 1, current + 1));
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, replay]);

  return (
    <ModalPortal>
      <div className="replay-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <div className="replay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="replay-heading">
            <div>
              <h2 id={titleId}>{replay.type === 'single' ? '单人对局回放' : '多人对局回放'}</h2>
              <p>
                {formatMode(replay.mode)} · {replay.type === 'single'
                  ? `${replay.status === 'won' ? '胜利' : '失败'} · ${replay.guessCount} 次猜测`
                  : `BO${replay.boType} · 我方 / ${replay.opponent.displayId} · ${formatMultiResult(replay.result)} · ${replay.me.score}:${replay.opponent.score}`}
              </p>
            </div>
            <button className="confirm-close" type="button" aria-label="关闭回放" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="replay-dialog-body">
            {replay.type === 'single' ? (
              <>
                <AnswerSection answer={replay.answer} />
                <section className="replay-guesses" aria-label="猜测过程">
                  <h3>猜测过程</h3>
                  {replay.guesses.length
                    ? <GuessBoard guesses={replay.guesses} />
                    : <p className="muted">本局未进行猜测。</p>}
                </section>
              </>
            ) : (
              <div className="replay-rounds">
                {activeRound ? (
                  <section className="replay-round" key={activeRound.round}>
                    <div className="replay-round-heading">
                      <h3>第 {activeRound.round} 轮</h3>
                      <Badge
                        text={activeRound.winner === 'me' ? '我方获胜' : activeRound.winner === 'opponent' ? '对方获胜' : '平局'}
                        color={activeRound.winner === 'me' ? 'green' : 'gray'}
                      />
                    </div>
                    <AnswerSection answer={activeRound.answer} />
                    <div className="replay-sides">
                      <div className="replay-side">
                        <h4><User size={15} />我方</h4>
                        {activeRound.me.guesses.length
                          ? <GuessBoard guesses={activeRound.me.guesses} />
                          : <p className="muted">本轮未猜测</p>}
                      </div>
                      <div className="replay-side">
                        <h4><Swords size={15} />{replay.opponent.displayId}</h4>
                        {activeRound.opponent.guesses.length
                          ? <GuessBoard guesses={activeRound.opponent.guesses} />
                          : <p className="muted">本轮未猜测</p>}
                      </div>
                    </div>
                  </section>
                ) : <p className="muted">这场对局没有可用的逐轮记录。</p>}
                {roundCount > 0 && (
                  <div className="replay-round-pagination" aria-label="回放轮次翻页">
                    <button className="btn btn-ghost" type="button" aria-label="上一轮" title="上一轮" disabled={roundIndex === 0} onClick={() => setRoundIndex((current) => Math.max(0, current - 1))}>
                      <ChevronLeft size={17} />
                    </button>
                    <span>第 {roundIndex + 1} / {roundCount} 轮</span>
                    <button className="btn btn-ghost" type="button" aria-label="下一轮" title="下一轮" disabled={roundIndex >= roundCount - 1} onClick={() => setRoundIndex((current) => Math.min(roundCount - 1, current + 1))}>
                      <ChevronRight size={17} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
