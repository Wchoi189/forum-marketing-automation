import React from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import type { SessionView } from '../lib/controlPanel';

function formatAge(fromIso: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 3_600_000));
  return hours >= 48 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
}

/** ppomppu session warning (SL-005). Renders nothing while the session is healthy or unknown. */
export default function SessionBanner({ session }: { session?: SessionView }) {
  if (!session || (session.status !== 'expiring' && session.status !== 'dead')) return null;
  const now = Date.now();
  const consoleLink = (
    <a href="/session/console" className="underline font-bold hover:opacity-80">
      session console
    </a>
  );

  if (session.status === 'dead') {
    return (
      <div className="flex items-start gap-3 p-4 rounded-2xl border bg-red-600/15 border-red-500/40 text-sm">
        <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-red-300">
            ppomppu session is dead{session.lostReason ? ` (${session.lostReason})` : ''}
          </p>
          <p className="text-xs opacity-70 mt-1">
            {session.lostAt ? `Lost ${new Date(session.lostAt).toLocaleString()}. ` : ''}
            The scheduler is parked and nothing posts until someone logs in. Log in through the {consoleLink}
            {' '}from any tailnet device, or import cookies from a shell with <code>npm run session:import</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl border bg-amber-500/10 border-amber-500/40 text-sm">
      <KeyRound className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-amber-300">ppomppu session is expiring</p>
        <p className="text-xs opacity-70 mt-1">
          {session.importedAt ? `Logged in ${formatAge(session.importedAt, now)} ago` : 'Login age unknown'}
          {session.expectedEndAt ? `; expected to end around ${new Date(session.expectedEndAt).toLocaleString()}` : ''}.
          {' '}A fresh login through the {consoleLink} keeps posting uninterrupted.
        </p>
      </div>
    </div>
  );
}
