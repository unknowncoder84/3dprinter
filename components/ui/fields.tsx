'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function Section({ title, children, defaultOpen = true, testId }: { title: string; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-b border-slate-200" data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50">
        {title}
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div id={id} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

const format = (v: number) => String(Math.round(v * 1000) / 1000);

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  testId?: string;
  hint?: string;
}

/** Numeric input that only commits valid values; shows the allowed range while invalid. */
export function NumberField({ label, value, onChange, min, max, step = 1, unit = 'mm', testId, hint }: NumberFieldProps) {
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused]);
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          data-testid={testId}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          aria-invalid={!valid}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (!valid) setText(format(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          className={`w-full rounded-lg border px-2.5 py-1.5 pr-9 text-sm tabular-nums outline-none focus:ring-2 ${valid ? 'border-slate-300 focus:ring-green-500' : 'border-red-400 bg-red-50 focus:ring-red-400'}`}
        />
        {unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unit}</span>}
      </div>
      {/* The error floats over the content below instead of pushing it down: if it were inline,
          it would disappear on blur and shift the layout between mouse-down and mouse-up of a
          click on another control, which loses that click. */}
      {!valid && (
        <p className="absolute left-0 top-full z-20 mt-0.5 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[11px] text-white shadow" role="alert">
          Enter a value from {min} to {max}.
        </p>
      )}
      {valid && hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  display,
  testId,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  display?: (v: number) => string;
  testId?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        <span className="text-xs tabular-nums text-slate-500">{display ? display(value) : value}</span>
      </div>
      <input id={id} data-testid={testId} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-green-600" />
    </div>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, testId }: { label: string; value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; testId?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <select id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value as T)} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-500">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ label, checked, onChange, testId, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 ${checked ? 'bg-green-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm text-slate-800">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </label>
    </div>
  );
}

export function ColorField({ label, value, onChange, testId, hint }: { label: string; value: string; onChange: (v: string) => void; testId?: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          data-testid={testId}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
        />
        <code className="rounded bg-slate-100 px-2 py-1 text-xs uppercase text-slate-600">{value}</code>
      </div>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
