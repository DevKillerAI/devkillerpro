"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins, LogOut, ShieldCheck, X } from "lucide-react";

export type ProfileAccount = {
  name: string;
  email?: string;
  role: string;
  unlimited: boolean;
  creditsRemaining: number | null;
  creditLimit: number | null;
  administration?: boolean;
  generatorEnabled?: boolean;
  generatorBudgetMicros?: number | null;
  generatorSpentMicros?: number;
  generatorReservedMicros?: number;
};

export function profileInitials(name?: string) {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U"
  );
}

export function ProfileModal({
  open,
  onClose,
  account,
}: {
  open: boolean;
  onClose: () => void;
  account: ProfileAccount | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out");
      window.location.assign("/login");
    } catch {
      setError("Unable to sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="profile-title"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-0 text-[#111522] shadow-2xl backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm"
    >
      <div className="relative border-b border-slate-100 bg-gradient-to-br from-white to-rose-50/70 p-7">
        <button
          autoFocus
          type="button"
          onClick={onClose}
          aria-label="Close profile"
          className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:bg-white focus-visible:outline-[#FF4B72]"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#111522] text-xl font-bold text-white ring-4 ring-white">
          {profileInitials(account?.name)}
        </div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF4B72]">
          Your workspace account
        </p>
        <h2 id="profile-title" className="text-2xl font-bold tracking-tight">
          {account?.name || "Your profile"}
        </h2>
        {account?.email && (
          <p className="mt-1 break-all text-sm text-slate-500">{account.email}</p>
        )}
      </div>
      <div className="space-y-5 p-7">
        {account ? (
          <>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex items-center gap-2 text-slate-500">
                <ShieldCheck className="h-4 w-4" />
                Account role
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize">
                {account.role}
              </span>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-5">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Coins className="h-4 w-4 text-[#FF4B72]" />
                Mission credits
              </p>
              <p className="mt-2 text-2xl font-bold">
                {account.unlimited ? "Unlimited" : account.creditsRemaining}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {account.unlimited
                  ? "No mission credit limit on your account."
                  : `Remaining from your ${account.creditLimit} allocated credits.`}
              </p>
            </div>
            {account.generatorEnabled && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-medium text-slate-500">
                  AI creation budget
                </p>
                <p className="mt-2 text-2xl font-bold">
                  {account.generatorBudgetMicros == null
                    ? "Owner managed"
                    : `$${Math.max(
                        0,
                        (account.generatorBudgetMicros -
                          (account.generatorSpentMicros || 0) -
                          (account.generatorReservedMicros || 0)) /
                          1e6
                      ).toFixed(2)}`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {account.generatorBudgetMicros == null
                    ? "Managed separately for the owner account."
                    : `Remaining from $${(
                        account.generatorBudgetMicros / 1e6
                      ).toFixed(2)}. Pending requests are included.`}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Account details are currently unavailable. Close and reopen your profile to try again.
          </p>
        )}
        {account?.administration && (
          <Link
            href="/admin"
            className="block rounded-xl border border-rose-100 bg-rose-50/50 px-4 py-3 text-center text-sm font-semibold text-[#FF4B72]"
          >
            Administration & quality →
          </Link>
        )}
        <p className="text-xs leading-relaxed text-slate-400">
          Your profile and credit balance are managed by your workspace administrator.
        </p>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <button
          type="button"
          disabled={signingOut}
          onClick={signOut}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold transition hover:bg-slate-50 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </dialog>
  );
}
