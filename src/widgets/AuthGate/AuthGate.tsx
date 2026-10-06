import type { ReactNode } from "react";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  return <>{children}</>;
}
