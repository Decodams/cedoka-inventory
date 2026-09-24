import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'cedoka:install-prompt-dismissed';

/** True when the app is already running as an installed (standalone) app. */
function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (
    iosStandalone ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

/** iOS Safari never fires beforeinstallprompt, so it needs manual instructions. */
function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  const isOtherBrowserOnIos = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return isIosDevice && !isOtherBrowserOnIos;
}

/**
 * "Add to Home Screen" control. Uses the browser install prompt where it exists
 * (Android Chrome, desktop Chrome/Edge) and falls back to iOS instructions.
 */
export function InstallAppButton({ className = '' }: { className?: string }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Keep the event so the user can trigger the native prompt from our button.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayModeChange = () => setInstalled(isStandaloneDisplay());
    media.addEventListener?.('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener?.('change', onDisplayModeChange);
    };
  }, []);

  if (installed || dismissed) return null;

  const iosFallback = isIosSafari();
  // Nothing to offer: the browser has no install API and it is not iOS Safari
  // (Chrome fires beforeinstallprompt as soon as the app becomes installable).
  if (!promptEvent && !iosFallback) return null;

  const handleInstall = async () => {
    if (!promptEvent) {
      setShowIosHelp(true);
      return;
    }
    setBusy(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
      } else {
        try {
          window.localStorage.setItem(DISMISS_KEY, '1');
        } catch {
          /* storage unavailable */
        }
        setDismissed(true);
      }
      setPromptEvent(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstall}
        disabled={busy}
        title="Add Cedoka to your home screen"
        className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 ${className}`}
      >
        <Download size={16} />
        <span className="hidden sm:inline">{busy ? 'Opening…' : 'Install app'}</span>
      </button>

      <Modal open={showIosHelp} onClose={() => setShowIosHelp(false)} title="Add Cedoka to your Home Screen" size="sm">
        <div className="space-y-4 text-sm text-slate-600">
          <p>iPhone and iPad install apps from Safari&apos;s share menu:</p>
          <ol className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">1</span>
              <span className="flex items-center gap-2">
                Tap the <Share size={16} className="text-slate-500" /> <strong>Share</strong> button in Safari&apos;s toolbar.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">2</span>
              <span className="flex items-center gap-2">
                Choose <SquarePlus size={16} className="text-slate-500" /> <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">3</span>
              <span>Tap <strong>Add</strong>. Cedoka opens next time as a full-screen app.</span>
            </li>
          </ol>
          <p className="text-xs text-slate-400">Already using Chrome or Edge? Open the browser menu and pick &ldquo;Install app&rdquo; / &ldquo;Add to Home screen&rdquo;.</p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setShowIosHelp(false)}>Got it</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
