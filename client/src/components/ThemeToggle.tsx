import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getTheme, setTheme, subscribeTheme } from '../store/theme';

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'blast');
  const nextTheme = theme === 'blast' ? 'light' : 'blast';
  const label = nextTheme === 'light' ? '切换到浅色主题' : '切换到深色主题';

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
    >
      {nextTheme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
      <span className="btn-text">{nextTheme === 'light' ? '浅色' : '深色'}</span>
    </button>
  );
}
