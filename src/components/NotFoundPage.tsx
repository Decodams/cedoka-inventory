import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
          <FileQuestion size={30} />
        </div>
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-400">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The address does not match a page in Cedoka Global.</p>
        <Button className="mt-6" onClick={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}>
          <Home size={16} /> Return home
        </Button>
      </div>
    </div>
  );
}
