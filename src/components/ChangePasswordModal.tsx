import { useState } from 'react';
import { Loader2, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClose = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setSuccess(null);
    onClose();
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    if (!current) {
      setError('Enter your current password.');
      return;
    }
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    const { error: err } = await changePassword(current, next);
    if (err) {
      setError(err);
      setSaving(false);
      return;
    }
    setSaving(false);
    setSuccess('Password updated successfully.');
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  return (
    <Modal open={open} onClose={handleClose} title="Change Password" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ShieldCheck size={16} />
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Passwords are securely hashed and can never be viewed. Use this form to set a new password for your account.
          </p>
        </div>
        <Input
          label="Current Password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Your current password"
          autoComplete="current-password"
          autoFocus
        />
        <Input
          label="New Password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />
        <Input
          label="Confirm New Password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat the new password"
          autoComplete="new-password"
        />
        {success && <p role="status" className="text-sm text-emerald-700 px-1">{success}</p>}
        {error && <p role="alert" className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Updating...
              </>
            ) : (
              <>
                <KeyRound size={16} /> Update Password
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}