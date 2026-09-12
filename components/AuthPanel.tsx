"use client";
import { useEffect, useState } from "react";
import { signIn, signOut, useSession, getProviders } from "next-auth/react";

export function useGoogleAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    getProviders()
      .then((p) => {
        if (live) setAvailable(Boolean(p && p.google));
      })
      .catch(() => {
        if (live) setAvailable(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return available;
}

export function SignInButton({ label = "Sign in with Google" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleAvailable = useGoogleAvailable();
  return (
    <div className="w-full">
      <button
        disabled={busy || googleAvailable === false}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            // redirect:true navigates to Google; if we are still here, it failed.
            await signIn("google", { redirect: true, callbackUrl: "/" });
            setError("Sign-in failed. Please try again.");
            setBusy(false);
          } catch {
            setError("Sign-in failed. Please try again.");
            setBusy(false);
          }
        }}
        className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        {busy ? "Signing in..." : label}
      </button>
      {googleAvailable === false && (
        <div className="mt-1 text-[11px] text-neutral-500">Google login chưa cấu hình (thiếu GOOGLE_CLIENT_ID).</div>
      )}
      {error && <div className="mt-1 text-[11px] text-red-600">{error}</div>}
    </div>
  );
}

export function AccountBlock() {
  const { data: session, status } = useSession();
  const [busy, setBusy] = useState(false);
  if (status === "loading") {
    return <div className="px-2 py-2 text-xs text-neutral-500">Loading account...</div>;
  }
  if (!session?.user) return <SignInButton />;
  const name = session.user.name ?? "Account";
  const img = (session.user as { image?: string | null }).image;
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-300 text-xs font-bold dark:bg-neutral-700">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1 truncate text-xs font-medium">{name}</div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signOut({ redirect: true, callbackUrl: "/" });
          } finally {
            setBusy(false);
          }
        }}
        title="Sign out"
        className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-900"
      >
        {busy ? "..." : "Sign out"}
      </button>
    </div>
  );
}
