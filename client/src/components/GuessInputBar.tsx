import { FormEvent, useEffect, useRef, useState } from 'react';
import { getPlayerList, searchPlayerList } from '../api/playerList';

interface Suggestion {
  id: number;
  nickname: string;
}

interface Props {
  onPick: (player: Suggestion) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  buttonText?: string;
}

/**
 * 底部输入栏:选手昵称输入 + 提交按钮,自动补全列表从输入框上方弹出(原版布局)。
 * 回车提交当前高亮项,方向键切换。
 */
export default function GuessInputBar({
  onPick,
  disabled,
  placeholder = '输入选手昵称...',
  buttonText = '提交猜测',
}: Props) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<number>();
  const input = useRef<HTMLInputElement>(null);
  const refocusAfterSubmit = useRef(false);
  const players = useRef<Suggestion[]>([]);

  useEffect(() => {
    void getPlayerList().then((list) => {
      players.current = list;
    });
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!text.trim()) {
      setItems([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      void getPlayerList().then((list) => {
        players.current = list;
        const next = searchPlayerList(list, text);
        setItems(next);
        setActive(0);
        setOpen(next.length > 0);
      }).catch(() => undefined);
    }, 80);
    return () => window.clearTimeout(timer.current);
  }, [text]);

  useEffect(() => {
    if (submitting || disabled || !refocusAfterSubmit.current) return;
    refocusAfterSubmit.current = false;
    input.current?.focus();
  }, [disabled, submitting]);

  useEffect(() => {
    const focusInputOnEnter = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.defaultPrevented ||
        event.isComposing ||
        submitting ||
        disabled ||
        document.querySelector('[aria-modal="true"]')
      ) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"]')
      ) return;

      event.preventDefault();
      input.current?.focus();
    };

    window.addEventListener('keydown', focusInputOnEnter);
    return () => window.removeEventListener('keydown', focusInputOnEnter);
  }, [disabled, submitting]);

  const pick = async (item: Suggestion) => {
    if (disabled || submitting) return;
    refocusAfterSubmit.current = true;
    setSubmitting(true);
    try {
      await onPick(item);
      setText('');
      setItems([]);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (items.length) void pick(items[active]);
  };

  return (
    <>
      {open && (
        <ul className="autocomplete-list">
          {items.map((item, i) => (
            <li
              key={item.id}
              className={i === active ? 'active' : ''}
              onMouseDown={() => void pick(item)}
            >
              {item.nickname}
            </li>
          ))}
        </ul>
      )}
      <form className="input-bar" onSubmit={submit}>
        <input
          ref={input}
          className="input"
          value={text}
          disabled={disabled || submitting}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!items.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + items.length) % items.length);
            }
          }}
        />
        <button className="btn" disabled={disabled || submitting || !items.length}>
          {submitting ? '提交中...' : buttonText}
        </button>
      </form>
    </>
  );
}
