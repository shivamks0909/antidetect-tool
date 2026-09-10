// Telemetry is disabled in Opinion Insights Browser.

export function initAnalytics(): Promise<void> {
  return Promise.resolve();
}

export async function trackSection(_section: string): Promise<void> {
  // Telemetry disabled
}

export async function send(
  _name: string,
  _params: Record<string, string | number> = {},
  _section = "",
): Promise<void> {
  // Telemetry disabled
}
