import { useEffect, type ReactNode } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { useAuthStore } from "../../features/auth/model/useAuthStore";
import { LoginForm } from "../../features/auth/ui/LoginForm";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const init = useAuthStore((s) => s.init);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const signOut = useAuthStore((s) => s.signOut);

  useEffect(() => {
    init();
  }, [init]);

  // Initial session restoration state
  if (status === "loading") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-bg-weak-50 text-text-strong-950 select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 animate-pulse items-center justify-center rounded-2xl bg-white p-2 shadow-md ring-1 ring-inset ring-slate-200">
            <img src="/logo.png" alt="Opinion Insights" className="size-10 object-contain" />
          </div>
          <div className="text-label-sm font-medium text-text-sub-600">
            Verifying authentication session…
          </div>
        </div>
      </div>
    );
  }

  // Account deactivated / disabled state
  if (status === "deactivated") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-weak-50 text-text-strong-950 select-none p-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-stroke-soft-200 bg-bg-white-0 p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-error-alpha-10 text-error-base ring-1 ring-inset ring-error-alpha-24">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="m-0 mb-2 text-title-h6 font-bold text-text-strong-950">
            Account Deactivated
          </h2>
          <p className="m-0 mb-6 text-paragraph-xs text-text-soft-400 leading-relaxed">
            {error || "Your account has been deactivated. Please contact your administrator to regain access."}
          </p>
          <Button variant="neutral" mode="stroke" size="small" className="w-full" onClick={() => signOut()}>
            Return to Sign In
          </Button>
        </div>
      </div>
    );
  }

  // Unauthenticated / Unconfigured state
  if (status === "unauthenticated" || status === "unconfigured") {
    return <LoginForm />;
  }

  // Authenticated state: reveal workspace
  return <>{children}</>;
}
