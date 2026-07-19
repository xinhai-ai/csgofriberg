import { ReactNode } from 'react';
import { Globe, Crosshair, Calendar, Shield, Trophy } from 'lucide-react';
import { playerRoleLabel } from '../utils/playerRoles';

export interface AnswerInfo {
  nickname: string;
  team: string;
  nationality: string;
  role?: string;
  majorChampionships?: number;
  majorAppearances?: number;
}

/** 选手信息表(答案卡片/查询结果共用) */
export function PlayerInfoTable({ answer }: { answer: AnswerInfo }) {
  const rows: [ReactNode, string, ReactNode][] = [
    [<Shield size={14} key="i" />, '战队', answer.team || '-'],
    [<Globe size={14} key="i" />, '国籍', answer.nationality],
    [<Crosshair size={14} key="i" />, '位置', answer.role ? playerRoleLabel(answer.role) : '-'],
    [<Trophy size={14} key="i" />, 'Major 冠军数', answer.majorChampionships ?? 0],
    [<Calendar size={14} key="i" />, 'Major 次数', answer.majorAppearances ?? '-'],
  ];
  return (
    <table className="player-info-table">
      <tbody>
        {rows.map(([icon, label, value]) => (
          <tr key={label}>
            <td className="label">
              {icon}
              {label}
            </td>
            <td className="value">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  title: string;
  answer: AnswerInfo | null;
  extra?: ReactNode;
  actions: ReactNode;
}

/** 结算/答案遮罩卡片 */
export default function AnswerOverlay({ title, answer, extra, actions }: Props) {
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{title}</h2>
        {extra}
        {answer && (
          <>
            <p className="answer-name">{answer.nickname}</p>
            <PlayerInfoTable answer={answer} />
          </>
        )}
        <div className="btns">{actions}</div>
      </div>
    </div>
  );
}
