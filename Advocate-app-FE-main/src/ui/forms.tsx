// Red Tape form controls. Native inputs underneath (date, select, checkbox), so they
// work with the keyboard, autofill and screen readers without extra code.
import { useId, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import Icon, { type IconName } from './Icon';

type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | false | null;
  required?: boolean;
  full?: boolean;              // spans both columns of a .form-grid
  className?: string;
  children: (id: string, describedBy?: string) => ReactNode;
};

// Label, control, hint and error, wired together for assistive tech.
export function Field({ label, hint, error, required, full, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-h` : undefined;
  const errId = error ? `${id}-e` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' invalid' : ''}${full ? ' full' : ''}${className ? ` ${className}` : ''}`}>
      {label && <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>}
      {children(id, describedBy)}
      {hint && <span className="hint" id={hintId}>{hint}</span>}
      {error && <span className="err" id={errId} role="alert"><Icon name="warn" size="sm" />{error}</span>}
    </div>
  );
}

type Common = { label?: ReactNode; hint?: ReactNode; error?: ReactNode | false | null; full?: boolean; fieldClass?: string };

export function TextField({ label, hint, error, full, fieldClass, required, className, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} full={full} className={fieldClass}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} required={required} className={`input${className ? ` ${className}` : ''}`} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, full, fieldClass, required, className, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} full={full} className={fieldClass}>
      {(id, d) => <textarea id={id} aria-describedby={d} aria-invalid={!!error || undefined} required={required} className={`input${className ? ` ${className}` : ''}`} {...rest} />}
    </Field>
  );
}

export type Option = { value: string | number; label: string; disabled?: boolean };

export function SelectField({ label, hint, error, full, fieldClass, required, className, options, placeholder, ...rest }:
  Common & SelectHTMLAttributes<HTMLSelectElement> & { options: (Option | string)[]; placeholder?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} full={full} className={fieldClass}>
      {(id, d) => (
        <select id={id} aria-describedby={d} aria-invalid={!!error || undefined} required={required} className={`input${className ? ` ${className}` : ''}`} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => typeof o === 'string'
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

// Search box with the leading magnifier, as used in page toolbars.
export function SearchInput({ value, onChange, placeholder = 'Search', icon = 'search', className, ...rest }:
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { value: string; onChange: (v: string) => void; icon?: IconName }) {
  return (
    <div className={`input-icon${className ? ` ${className}` : ''}`}>
      <Icon name={icon} size="sm" />
      <input type="search" className="input" value={value} placeholder={placeholder} aria-label={rest['aria-label'] || placeholder}
        onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

export function Check({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className={`check${className ? ` ${className}` : ''}`}><input type="checkbox" {...rest} />{label}</label>;
}

export function Switch({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return <label className={`switch${className ? ` ${className}` : ''}`}><input type="checkbox" role="switch" {...rest} />{label && <span>{label}</span>}</label>;
}

// Segmented control (view switches: list/board, day/week/month).
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: IconName }[]; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size="sm" />}{o.label}
        </button>
      ))}
    </div>
  );
}

// Filter chip: a dashed pill that turns solid when on.
export function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="filter-chip" aria-pressed={on} onClick={onClick}>{children}</button>;
}

// Tabs over panels; the caller renders the active panel.
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = tabs.findIndex((x) => x.value === value);
            const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            onChange(n.value);
            (e.currentTarget.parentElement?.querySelectorAll('button')[tabs.indexOf(n)] as HTMLButtonElement | undefined)?.focus();
          }}>
          {t.label}{t.count != null && <span className="badge-n">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
