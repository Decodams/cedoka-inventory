import { BellRing, BellOff, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { formatDateTime } from '@/lib/dateUtils';
import type { AppNotification } from '@/types/database';

/**
 * In-app notification feed (spec 3): an unread-count bell in the top bar.
 * Opening the bell lists unread-then-recent notifications and marks them read.
 */
export function NotificationBell({ onGoToReports }: { onGoToReports: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const { data: notifications, refetch } = useSupabaseQuery<AppNotification[]>(
    () =>
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user?.id ?? '')
        .order('created_at', { ascending: false })
        .limit(25),
    [user?.id],
    { ttlMs: 0 },
  );

  const unreadCount = notifications?.filter((n) => !n.read_at).length ?? 0;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markAllRead = async () => {
    if (!user?.id || !unreadCount || marking) return;
    setMarking(true);
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null);
    setMarking(false);
    if (error) return;
    void refetch();
  };

  const openReport = () => {
    setOpen(false);
    onGoToReports();
  };

  return (
    <div className="relative" ref={panel}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
      >
        {unreadCount > 0 ? <BellRing size={20} /> : <BellOff size={20} />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-slate-200 shadow-lg z-40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                disabled={marking}
                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50"
              >
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!notifications?.length && (
              <p className="px-4 py-8 text-sm text-slate-400 text-center">No notifications yet.</p>
            )}
            {notifications?.map((notification) => (
              <button
                key={notification.id}
                onClick={openReport}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                  notification.read_at ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm text-slate-800 ${notification.read_at ? 'font-normal' : 'font-semibold'}`}>
                    {notification.title}
                  </p>
                  {!notification.read_at && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{notification.body}</p>
                <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(notification.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}