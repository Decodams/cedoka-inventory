import { AlertTriangle, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { supabaseConfigError } from '@/lib/supabaseClient';

/**
 * Rendered by main.tsx when the app was built/deployed without its Supabase
 * environment variables. Turns a silent white blank screen into a screen that
 * tells the deployer exactly what to fix.
 */
export function ConfigErrorScreen() {
  const [copied, setCopied] = useState(false);
  const vars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

  const copyNames = async () => {
    try {
      await navigator.clipboard.writeText(vars.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — names are visible above regardless
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center">
          <AlertTriangle size={24} />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">App is not connected</h1>
        <p className="mt-2 text-sm text-slate-500">
          {supabaseConfigError ?? 'The backend connection is not configured.'}
        </p>
        <div className="mt-5 text-left bg-slate-900 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Required variables
            </p>
            <button
              onClick={copyNames}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <code className="block text-xs text-emerald-300 font-mono leading-relaxed">
            VITE_SUPABASE_URL
            <br />
            VITE_SUPABASE_ANON_KEY
          </code>
        </div>
        <ol className="mt-5 text-left text-sm text-slate-600 space-y-2 list-decimal list-inside">
          <li>
            Open the hosting dashboard (Vercel → your project →{' '}
            <span className="font-medium text-slate-900">Settings → Environment Variables</span>).
          </li>
          <li>Add the two variables above for the Production environment.</li>
          <li>
            <span className="font-medium text-slate-900">Redeploy</span> (variables are baked in at
            build time — saving alone is not enough).
          </li>
        </ol>
      </div>
    </div>
  );
}
