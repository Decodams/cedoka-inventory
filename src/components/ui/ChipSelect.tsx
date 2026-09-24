import { Check } from 'lucide-react';

export interface ChipOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface ChipSelectProps {
  label: string;
  hint?: string;
  options: ChipOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Tailwind classes applied to a selected chip. */
  activeClass?: string;
  emptyMessage?: string;
}

/**
 * Toggle-chip multi-select used for business and branch scope: one Admin can be
 * added to as many businesses (and branches) as needed.
 */
export function ChipSelect({
  label,
  hint,
  options,
  selected,
  onChange,
  activeClass = 'bg-slate-900 text-white',
  emptyMessage = 'Nothing available.',
}: ChipSelectProps) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-slate-700">{label}</label>
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-slate-400 hover:text-slate-600">
            Clear all
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.length === 0 && <span className="text-xs text-slate-400">{emptyMessage}</span>}
        {options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(option.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                active ? `${activeClass} border-transparent` : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {active && <Check size={12} />}
              {option.label}
              {option.sublabel && <span className="opacity-60">{option.sublabel}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
