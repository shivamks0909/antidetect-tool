import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  role?: string | null;
}

export type AuthStatus = "authenticated";

export interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  token: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  error: string | null;
  isBusy: boolean;
  require2FA: boolean;
  tempToken: string | null;

  init: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  getValidAccessToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

const defaultUser: AuthUser = { id: "default", email: "local@offline" };
const defaultProfile: UserProfile = {
  id: "default",
  email: "local@offline",
  full_name: "Local User",
  is_active: true,
  role: "admin",
};

export const useAuthStore = create<AuthState>(() => ({
  user: defaultUser,
  profile: defaultProfile,
  token: "offline",
  refreshToken: "offline",
  status: "authenticated",
  error: null,
  isBusy: false,
  require2FA: false,
  tempToken: null,

  init: async () => {},
  refreshSession: async () => true,
  getValidAccessToken: async () => "offline",
  signIn: async () => true,
  verify2FA: async () => true,
  cancel2FA: () => {},
  signOut: async () => {},
  clearError: () => {},
  startHeartbeat: () => {},
  stopHeartbeat: () => {},
}));
