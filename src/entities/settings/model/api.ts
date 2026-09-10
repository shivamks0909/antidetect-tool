import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { Settings, ApiInfo, DataRootInfo } from "./types";

const defaultSettings: Settings = {
  browser_path: null,
  theme: "dark",
  minimize_to_tray: true,
  camera_enabled: false,
};

const defaultApiInfo: ApiInfo = {
  enabled: true,
  port: 40325,
  base_url: "http://127.0.0.1:40325",
  token: "mock-api-token",
};

export const settingsGet = () => safeInvoke<Settings>("settings_get", undefined, defaultSettings);
export const settingsSave = (value: Settings) => safeInvoke("settings_save", { value });
export const apiInfo = () => safeInvoke<ApiInfo>("api_info", undefined, defaultApiInfo);
export const apiRegenerateToken = () => safeInvoke<ApiInfo>("api_regenerate_token", undefined, defaultApiInfo);
export const mcpDownload = (dir: string) => safeInvoke<string>("mcp_download", { dir }, "");

export const dataRootGet = () => safeInvoke<DataRootInfo>("data_root_get", undefined, { path: "", custom: false, migrating: false });
export const dataRootMigrate = (path: string) => safeInvoke<number>("data_root_migrate", { path }, 0);
