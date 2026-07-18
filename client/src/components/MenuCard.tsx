import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  to: string;
  icon: ReactNode;
  label: string;
  color: string;
}

/** 首页田字格入口卡片 */
export default function MenuCard({ to, icon, label, color }: Props) {
  return (
    <Link to={to} className="menu-card" style={{ ['--menu-color' as string]: color }}>
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{label}</span>
    </Link>
  );
}
