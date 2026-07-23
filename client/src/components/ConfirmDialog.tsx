import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { useTranslation } from 'react-i18next';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warning' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

type ConfirmFunction = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFunction | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  const confirm = useCallback<ConfirmFunction>((options) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
  }, []);

  useEffect(() => () => {
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    if (!pending) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ModalPortal>
          <div
            className="confirm-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) settle(false);
            }}
          >
            <div
              className={`confirm-dialog ${pending.tone === 'danger' ? 'danger' : 'warning'}`}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={messageId}
            >
              <div className="confirm-icon" aria-hidden="true">
                <AlertTriangle size={22} />
              </div>
              <div className="confirm-content">
                <div className="confirm-heading">
                  <h2 id={titleId}>{pending.title}</h2>
                  <button
                    className="confirm-close"
                    type="button"
                    aria-label={t('common.close')}
                    onClick={() => settle(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p id={messageId}>{pending.message}</p>
                <div className="confirm-actions">
                  <button
                    ref={cancelButtonRef}
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => settle(false)}
                  >
                    {pending.cancelLabel ?? t('common.cancel')}
                  </button>
                  <button
                    className={`btn ${pending.tone === 'danger' ? 'btn-danger' : 'btn-warning'}`}
                    type="button"
                    onClick={() => settle(true)}
                  >
                    {pending.confirmLabel ?? t('common.confirm')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFunction {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('CONFIRM_PROVIDER_REQUIRED');
  return confirm;
}
