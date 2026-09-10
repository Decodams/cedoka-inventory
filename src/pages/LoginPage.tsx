import { useRef, useState, type FormEvent } from 'react';
import { Lock, Mail, Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import logo from '@/logo.jpeg';

export function LoginPage() {
  const { signIn, registerStaff } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [website, setWebsite] = useState('');
  const lastRegistrationAt = useRef(0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (mode === 'register') {
      if (website.trim()) {
        setError('Unable to submit registration.');
        setLoading(false);
        return;
      }
      if (Date.now() - lastRegistrationAt.current < 30_000) {
        setError('Please wait before submitting another registration.');
        setLoading(false);
        return;
      }
      if (fullName.trim().length < 2 || password.length < 8) {
        setError('Enter your full name and a password with at least 8 characters.');
        setLoading(false);
        return;
      }
      lastRegistrationAt.current = Date.now();
      const { error: registrationError } = await registerStaff(fullName, email, password);
      if (registrationError) setError(registrationError);
      else {
        setSuccess('Registration submitted. An administrator must approve your account before you can sign in.');
        setMode('login');
        setPassword('');
      }
      setLoading(false);
      return;
    }

    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      const normalizedError = signInError.toLowerCase();
      setError(normalizedError.includes('invalid login credentials') ? 'Invalid email or password. Please try again.' : signInError);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl brand-ink overflow-hidden mb-4 shadow-lg">
            <img src={logo} alt="Cedoka" className="h-full w-full object-cover object-[50%_35%]" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cedoka Global</h1>
          <p className="mt-2 text-sm text-slate-500">
            Business Operations & Management Platform
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 mb-6">
            <button type="button" onClick={() => { setMode('login'); setError(null); setSuccess(null); }} className={`flex-1 min-h-10 rounded-lg px-3 text-sm font-semibold ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Sign in</button>
            <button type="button" onClick={() => { setMode('register'); setError(null); setSuccess(null); }} className={`flex-1 min-h-10 rounded-lg px-3 text-sm font-semibold ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Register</button>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">{mode === 'login' ? 'Welcome back' : 'Request access'}</h2>
          <p className="text-sm text-slate-500 mb-6">{mode === 'login' ? 'Sign in to access your workspace' : 'Create a staff request for administrator approval'}</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">Full name</label>
                <div className="relative">
                  <UserPlus size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" placeholder="Your full name" className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
                </div>
              </div>
            )}

            <div className="hidden" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Email</label>
              <div className="relative">
                <Mail
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Password</label>
              <div className="relative">
                <Lock
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {success && (
              <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{success}</div>
            )}
            {error && (
              <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 active:bg-slate-950 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                mode === 'login' ? 'Sign In' : 'Submit Registration'
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Authorized personnel only. All actions are logged.
        </p>
      </div>
    </div>
  );
}
