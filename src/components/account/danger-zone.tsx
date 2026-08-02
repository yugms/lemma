"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import {
  clearHistoryAction,
  deleteAllDataAction,
  deleteAccountAction,
} from "@/app/account/actions";
import type { AccountSummary } from "@/lib/account";

type ActionId = "history" | "data" | "account";

/**
 * A full document load, not a router push: the session cookie is gone, so every
 * cached Server Component payload above this one describes a user that no
 * longer exists. Module scope because `react-hooks/immutability` forbids
 * assigning to `window.location` inside a component.
 */
function leaveToHome() {
  window.location.href = "/";
}

/**
 * Three destructive actions, ordered by how much they take.
 *
 * Each one is confirmed by typing its own phrase rather than by a shared "are
 * you sure": the difference between clearing history and deleting the account
 * is the whole point, and a generic dialog is exactly how someone confirms the
 * wrong one. The phrase is also what makes these safe to sit on one page.
 */
export function DangerZone({
  summary,
  isGuest,
}: {
  summary: AccountSummary;
  isGuest: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionId | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const nothingToClear =
    summary.attempts === 0 && summary.sessions === 0 && summary.scans === 0;

  const actions: {
    id: ActionId;
    title: string;
    body: string;
    removes: string[];
    keeps?: string;
    phrase: string;
    cta: string;
    disabled?: boolean;
    run: () => Promise<{ error?: string }>;
  }[] = [
    {
      id: "history",
      title: "Clear practice history",
      body: "Wipes everything you've earned by working through your sets. The sets themselves stay, so you can practise them again from scratch.",
      removes: [
        `${summary.attempts} answer${summary.attempts === 1 ? "" : "s"}`,
        `${summary.sessions} study session${summary.sessions === 1 ? "" : "s"}`,
        ...(summary.scans > 0
          ? [`${summary.scans} scanned page${summary.scans === 1 ? "" : "s"}`]
          : []),
        ...(summary.hasCoachRead ? ["your coach's read"] : []),
      ],
      keeps: `${summary.sets} set${summary.sets === 1 ? "" : "s"}`,
      phrase: "clear history",
      cta: "Clear history",
      disabled: nothingToClear,
      run: clearHistoryAction,
    },
    {
      id: "data",
      title: "Delete all my data",
      body: "Your sets go too. Each one cost model calls and a slot against your daily limit, so this is worth more than it looks — you'd have to generate them all again.",
      removes: [
        `${summary.sets} set${summary.sets === 1 ? "" : "s"}`,
        `${summary.attempts} answer${summary.attempts === 1 ? "" : "s"}`,
        "everything else on this account",
      ],
      keeps: "your account, so you stay signed in",
      phrase: "delete my data",
      cta: "Delete everything",
      disabled: summary.sets === 0 && nothingToClear,
      run: deleteAllDataAction,
    },
    {
      id: "account",
      title: isGuest ? "Delete this guest session" : "Delete my account",
      body: isGuest
        ? "You're working as a guest, so this account only exists in this browser. Deleting it removes the sets and history attached to it, and they cannot be recovered from another device."
        : "Removes the account itself along with everything in it, and signs you out. Signing in with Google again would start a completely new account.",
      removes: ["your account", "every set and answer on it"],
      phrase: "delete my account",
      cta: isGuest ? "Delete guest session" : "Delete account",
      run: deleteAccountAction,
    },
  ];

  async function confirm(action: (typeof actions)[number]) {
    setBusy(action.id);
    setError(null);
    try {
      const res = await action.run();
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(null);
      setTyped("");
      if (action.id === "account") {
        // Nothing on this page has an owner any more.
        leaveToHome();
        return;
      }
      setDone(action.title);
      router.refresh();
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {done && (
        <p role="status" className="aside-rule border-ok py-1 text-sm text-ok">
          {done} — done.
        </p>
      )}

      {actions.map((action) => {
        const isOpen = open === action.id;
        const matches = typed.trim().toLowerCase() === action.phrase;

        return (
          <section
            key={action.id}
            className={clsx(
              "rounded-[3px] border px-5 py-5 transition-colors",
              isOpen ? "border-bad" : "border-line"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-medium">{action.title}</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                  {action.body}
                </p>
              </div>
              {!isOpen && (
                <button
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(action.id);
                    setTyped("");
                    setError(null);
                    setDone(null);
                  }}
                  className="btn btn-sm shrink-0 border-bad text-bad hover:bg-bad-wash"
                >
                  {action.disabled ? "Nothing to remove" : action.cta}
                </button>
              )}
            </div>

            {isOpen && (
              <div className="mt-5 border-t border-line pt-5">
                <p className="mono-meta">This removes</p>
                <ul className="mt-2 space-y-1 text-sm text-bad">
                  {action.removes.map((r) => (
                    <li key={r}>— {r}</li>
                  ))}
                </ul>
                {action.keeps && (
                  <p className="mono-meta mt-3">Keeps {action.keeps}</p>
                )}

                <label className="mt-5 block">
                  <span className="text-sm text-muted">
                    Type <span className="font-mono text-fg">{action.phrase}</span> to
                    confirm
                  </span>
                  <input
                    value={typed}
                    autoFocus
                    disabled={busy !== null}
                    onChange={(e) => setTyped(e.target.value)}
                    aria-label={`Type ${action.phrase} to confirm`}
                    className="field mt-2 max-w-xs font-mono"
                  />
                </label>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!matches || busy !== null}
                    onClick={() => confirm(action)}
                    className="btn btn-sm border-bad bg-bad text-paper hover:opacity-90"
                  >
                    {busy === action.id && (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    )}
                    {action.cta}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setOpen(null);
                      setTyped("");
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    Cancel
                  </button>
                  <span className="mono-meta">This cannot be undone</span>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {error && (
        <p role="alert" className="aside-rule border-bad py-1 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
