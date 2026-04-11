import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function NumField({
  label,
  value,
  onChange,
  min = 0,
  max = 999999,
  step = 1,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  tooltip?: string;
}) {
  return (
    <>
      <label className="block text-xs opacity-60" title={tooltip}>
        {label}
        {tooltip && (
          <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/10 text-[9px] cursor-help align-middle opacity-50 hover:opacity-100 transition-opacity" title={tooltip}>?</span>
        )}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
      />
    </>
  );
}

export function SectionHeading({
  label,
  children,
  collapsible,
  open,
  onToggle,
}: {
  label: string;
  children?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center justify-between pt-2 border-t border-white/10">
      <button
        type="button"
        onClick={collapsible ? onToggle : undefined}
        className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest opacity-40 ${collapsible ? 'hover:opacity-70 transition-opacity cursor-pointer' : 'cursor-default'}`}
        aria-expanded={collapsible ? open : undefined}
      >
        {collapsible && (
          open
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />
        )}
        {label}
      </button>
      {children}
    </div>
  );
}
