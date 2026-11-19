import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          void install();
        }}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-[#C78E65] text-[#101827] font-semibold whitespace-nowrap shrink-0 transition-colors hover:bg-[#D59E76] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C78E65] ${
          compact ? 'px-3.5 py-2 text-xs min-h-[40px]' : 'w-full px-4 py-3 text-sm min-h-[44px]'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 text-slate-100 font-medium whitespace-nowrap shrink-0 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C78E65] ${
            compact ? 'px-3.5 py-2 text-xs min-h-[40px]' : 'w-full px-4 py-3 text-sm min-h-[44px]'
          }`}
        >
          <Share className="w-4 h-4 shrink-0" />
          <span>Install on iPhone</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-700/80 bg-[#151F32] p-6 shadow-2xl">
              <div className="flex items-center justify-between gap-4">
                <h3 id="ios-install-title" className="font-display text-base font-semibold text-slate-100">
                  Install on iPhone or iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-slate-300 leading-relaxed list-decimal list-inside">
                <li>Tap the Share icon in the Safari toolbar.</li>
                <li>Scroll down and tap Add to Home Screen.</li>
                <li>Tap Add to launch eli kunju fullscreen.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[44px] rounded-xl bg-[#C78E65] px-4 py-2.5 text-sm font-semibold text-[#101827] hover:bg-[#D59E76] transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
