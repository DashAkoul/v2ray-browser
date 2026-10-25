import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckIcon, ChevronDownIcon, CloseIcon, InfoIcon, SearchIcon } from './icons';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  full = false,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('vb-btn', `vb-btn--${variant}`, `vb-btn--${size}`, full && 'vb-btn--full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="vb-btn__spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
}

export function IconButton({ label, size = 'md', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('vb-icon-btn', size === 'sm' && 'vb-icon-btn--sm', className)}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="vb-btn__spinner"
      style={{ width: size, height: size, display: 'inline-block' }}
      role="status"
      aria-label="Loading"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  flat = false,
}: {
  children: ReactNode;
  className?: string;
  flat?: boolean;
}) {
  return <div className={cx('vb-card', flat && 'vb-card--flat', className)}>{children}</div>;
}

export function Divider() {
  return <hr className="vb-divider" />;
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  title?: string;
}) {
  return (
    <span className={cx('vb-badge', `vb-badge--${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  children,
}: {
  status: 'idle' | 'pending' | 'active' | 'error';
  children: ReactNode;
}) {
  return (
    <span className={cx('vb-status', `vb-status--${status}`)}>
      <span className="vb-status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="vb-field">
      <label className="vb-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="vb-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="vb-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx('vb-input', className)} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select {...rest} className={cx('vb-select', className)}>
        {children}
      </select>
      <ChevronDownIcon
        size={14}
        style={{ position: 'absolute', insetInlineEnd: 10, pointerEvents: 'none', color: 'var(--vb-muted)' }}
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="vb-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <div className="vb-search">
      <span className="vb-search__icon">
        <SearchIcon size={14} />
      </span>
      <input
        type="search"
        className="vb-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="vb-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cx('vb-modal', size === 'sm' && 'vb-modal--sm')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="vb-modal__header">
          <h2 className="vb-modal__title" id={titleId}>
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <CloseIcon size={16} />
          </IconButton>
        </div>
        <div className="vb-modal__body">{children}</div>
        {footer ? <div className="vb-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="vb-soft vb-small">{description}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Empty / skeleton                                                    */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="vb-empty">
      {icon ? <div className="vb-empty__icon">{icon}</div> : null}
      <div className="vb-empty__title">{title}</div>
      {description ? <div className="vb-small">{description}</div> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 12 }: { width?: number | string; height?: number }) {
  return <div className="vb-skeleton" style={{ width, height }} />;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export interface TabItem {
  id: string;
  label: string;
  badge?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="vb-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className="vb-tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.badge !== undefined && item.badge > 0 ? ` (${item.badge})` : ''}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = setTimeout(() => dismiss(id), tone === 'error' ? 6500 : 4000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="vb-toasts" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx('vb-toast', `vb-toast--${toast.tone}`)} role="status">
          <span style={{ marginTop: 1, color: 'var(--vb-muted)' }}>
            {toast.tone === 'error' ? <AlertIcon size={14} /> : toast.tone === 'success' ? <CheckIcon size={14} /> : <InfoIcon size={14} />}
          </span>
          <span className="vb-grow">{toast.message}</span>
          <button
            type="button"
            className="vb-toast__close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
