import { ArrowUp, ArrowDown } from 'lucide-react';
import {
  AttributeFeedback,
  HiddenAttributeFeedback,
  MultiplayerGuessFeedback,
} from '../types';
import { playerRoleLabel } from '../utils/playerRoles';

const COLUMNS = ['昵称', '队伍', '国家或地区', '年龄', '位置', 'Major 冠军', 'Major 次数', '状态'];

function Cell({
  attr,
  label,
  bool,
  format,
}: {
  attr: AttributeFeedback | HiddenAttributeFeedback;
  label: string;
  bool?: boolean;
  format?: (value: string) => string;
}) {
  if (!('value' in attr)) {
    return (
      <td className={`${attr.level} masked-cell`} data-label={label}>
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
      : format
        ? format(String(attr.value))
        : String(attr.value);
  return (
    <td className={attr.level} data-label={label}>
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
              <td
                className={`name ${g.correct ? 'correct' : ''} ${'hidden' in g ? 'masked-cell' : ''}`}
                data-label={COLUMNS[0]}
              >
                {'hidden' in g ? null : g.nickname}
              </td>
              <Cell attr={g.attributes.team} label={COLUMNS[1]} />
              <Cell attr={g.attributes.nationality} label={COLUMNS[2]} />
              <Cell attr={g.attributes.age} label={COLUMNS[3]} />
              <Cell attr={g.attributes.role} label={COLUMNS[4]} format={playerRoleLabel} />
              <Cell attr={g.attributes.majorChampionships} label={COLUMNS[5]} />
              <Cell attr={g.attributes.majorAppearances} label={COLUMNS[6]} />
              <Cell attr={g.attributes.isActive} label={COLUMNS[7]} bool />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
