export type ExtensionEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Largest icon the manifest declares, as a data: URL. Empty when it has none. */
  icon: string;
  path: string;
  size_bytes: number;
  /** "@<unix_secs>". */
  added_at: string;
};

export interface ExtensionSet {
  id: string;
  owner_account_id?: string;
  name: string;
  description?: string;
  extension_ids: string[];
  created_at: string;
  updated_at?: string;
}
