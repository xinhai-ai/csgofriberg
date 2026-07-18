import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

interface Props {
  title: string;
  icon?: ReactNode;
  /** 顶栏右侧动作区 */
  actions?: ReactNode;
  /** 顶栏下方状态条 */
  statusBar?: ReactNode;
  children: ReactNode;
  /** 底部固定输入区(含自动补全) */
  dock?: ReactNode;
  showHome?: boolean;
}

/**
 * 页面骨架:顶栏 + 可选状态条 + 滚动内容区 + 可选底部输入坞。
 * 满高布局,移动端输入栏贴底并处理安全区。
 */
export default function Page({
  title,
  icon,
  actions,
  statusBar,
  children,
  dock,
  showHome = true,
}: Props) {
  return (
    <div className="page">
      <div className="header-bar">
        <span className="title">
          {icon}
          {title}
        </span>
        <span className="btns">
          {actions}
          {showHome && (
            <Link to="/" className="btn btn-ghost btn-sm" aria-label="主菜单">
              <Home size={15} />
              <span className="btn-text">主菜单</span>
            </Link>
          )}
        </span>
      </div>
      {statusBar && <div className="status-bar">{statusBar}</div>}
      <div className="page-scroll">{children}</div>
      {dock && <div className="input-dock">{dock}</div>}
    </div>
  );
}
