import { ArrowUp, ArrowDown } from 'lucide-react';
import {
  AttributeFeedback,
  HiddenAttributeFeedback,
  MultiplayerGuessFeedback,
} from '../types';

const COLUMNS = ['昵称', '队伍', '国家或地区', '年龄', '位置', 'Major 次数', '状态'];

function Cell({ attr, bool }: { attr: AttributeFeedback | HiddenAttributeFeedback; bool?: boolean }) {
  if (!('value' in attr)) {
    return (
      <td className={`${attr.level} masked-cell`}>
        {attr.hint && attr.level !== 'correct' && (
          <span className="dir">
            {attr.hint === 'higher' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          </span>
        )}
      </td>
    );
  }
  const text =
    typeof attr.value === 'boolean' || bool
      ? attr.value
        ? '现役'
        : '退役'
      : String(attr.value);
  return (
    <td className={attr.level}>
      {text}
      {attr.hint && attr.level !== 'correct' && (
        <span className="dir">
          {attr.hint === 'higher' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
        </span>
      )}
    </td>
  );
}

/** 猜测反馈表:原版 game-table 布局,每行一次猜测的逐属性对比 */
export default function GuessBoard({ guesses }: { guesses: MultiplayerGuessFeedback[] }) {
  return (
    <div className="game-table-wrap">
      <table className="game-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {guesses.map((g, i) => (
            <tr key={'hidden' in g ? `hidden-${i}` : `${g.playerId}-${i}`}>
              <td className={`name ${g.correct ? 'correct' : ''} ${'hidden' in g ? 'masked-cell' : ''}`}>
                {'hidden' in g ? null : g.nickname}
              </td>
              <Cell attr={g.attributes.team} />
              <Cell attr={g.attributes.nationality} />
              <Cell attr={g.attributes.age} />
              <Cell attr={g.attributes.role} />
              <Cell attr={g.attributes.majorAppearances} />
              <Cell attr={g.attributes.isActive} bool />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
