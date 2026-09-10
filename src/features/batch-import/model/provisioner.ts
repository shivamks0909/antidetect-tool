import type { BatchImportJob } from "./types";
import { defaultForm, toStored } from "../../../entities/profile/model/form";
import { profileSave, profileBindProxy, profileSetFolder } from "../../../entities/profile/model/api";
import { proxySave } from "../../../entities/proxy/model/api";
import { API_BASE, apiFetch } from "../../../config/api";
import { saveActiveJob } from "./jobStorage";

export interface ProvisioningOptions {
  concurrency?: number;
  onProgress?: (job: BatchImportJob) => void;
  signal?: AbortSignal;
}

/**
 * Execute batch provisioning of valid rows into real, isolated browser profiles
 */
export async function executeBatchProvisioning(
  job: BatchImportJob,
  options: ProvisioningOptions = {}
): Promise<BatchImportJob> {
  const { concurrency = 3, onProgress, signal } = options;

  job.status = "running";
  job.updatedAt = new Date().toISOString();
  saveActiveJob(job);
  onProgress?.(job);

  const token = localStorage.getItem("opinion_jwt_token");

  // Filter pending valid rows
  const pendingIndices: number[] = [];
  job.rows.forEach((r, idx) => {
    if (r.status === "valid" && r.executionStatus !== "completed") {
      pendingIndices.push(idx);
    }
  });

  let cursor = 0;
  const activeWorkers: Promise<void>[] = [];

  const worker = async () => {
    while (cursor < pendingIndices.length) {
      if (signal?.aborted) {
        job.status = "paused";
        saveActiveJob(job);
        return;
      }

      const itemIdx = pendingIndices[cursor++];
      if (itemIdx === undefined) break;

      const row = job.rows[itemIdx];
      if (!row) continue;

      row.executionStatus = "creating";
      onProgress?.(job);

      try {
        // 1. If row has proxy, save proxy first
        let boundProxyId: string | null = null;
        if (row.parsedProxy) {
          const savedProxy = await proxySave(row.parsedProxy);
          boundProxyId = savedProxy.id;

          // Sync proxy to server if authenticated
          if (token) {
            apiFetch(`${API_BASE}/data/proxies`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(savedProxy),
            }).catch(() => {});
          }
        }

        // 2. Build profile form payload
        const form = defaultForm();
        form.name = row.parsedTitle;
        form.notes = row.parsedNotes || "";
        form.proxy_id = boundProxyId;
        if (row.parsedTimezone) form.timezone = row.parsedTimezone;
        if (row.parsedUserAgent) form.user_agent = row.parsedUserAgent;
        if (row.parsedLanguage) form.language = row.parsedLanguage;
        
        const targetExtensions = row.resolvedExtensions || row.parsedExtensions || [];
        if (targetExtensions.length > 0) {
          form.extensions = targetExtensions;
        }

        if (row.parsedGeolocation) {
          form.geo_mode = "manual";
          form.geo_lat = row.parsedGeolocation.latitude;
          form.geo_lng = row.parsedGeolocation.longitude;
        }

        // 3. Convert to full stored config
        const payload = toStored(form, null);

        if (targetExtensions.length > 0) {
          if (!payload._meta) payload._meta = {};
          payload._meta.extensions = targetExtensions;
          payload.extensions = targetExtensions;
        }

        // Attach screen resolution, platform, start URLs, tags, and initial cookies
        if (row.parsedScreenResolution) {
          payload.screen = {
            width: row.parsedScreenResolution.width,
            height: row.parsedScreenResolution.height,
          };
          if (!payload.config) payload.config = {};
          payload.config.screen = payload.screen;
        }

        if (row.parsedPlatform) {
          payload.platform = row.parsedPlatform;
          if (!payload.config) payload.config = {};
          payload.config.platform = row.parsedPlatform;
        }

        if (row.parsedStartUrls && row.parsedStartUrls.length > 0) {
          payload.start_urls = row.parsedStartUrls;
          if (!payload.config) payload.config = {};
          payload.config.start_urls = row.parsedStartUrls;
        }

        if (row.parsedTags && row.parsedTags.length > 0) {
          payload.tags = row.parsedTags;
          if (!payload.config) payload.config = {};
          payload.config.tags = row.parsedTags;
        }

        if (row.parsedCookie) {
          payload.initial_cookies = row.parsedCookie;
          if (!payload.config) payload.config = {};
          payload.config.initial_cookies = row.parsedCookie;
        }

        // 4. Save profile to account-scoped filesystem
        const savedProfile = await profileSave(payload);
        row.createdProfileId = savedProfile.id;

        // 5. Bind proxy if applicable
        if (boundProxyId) {
          await profileBindProxy(savedProfile.id, boundProxyId);
        }

        // 6. Assign folder if provided
        if (row.parsedFolder) {
          try {
            await profileSetFolder(savedProfile.id, row.parsedFolder);
          } catch (folderErr) {
            console.warn(`[BatchImport] Could not set folder "${row.parsedFolder}":`, folderErr);
          }
        }

        // 7. Sync profile to server if authenticated (full antidetect configuration)
        if (token) {
          apiFetch(`${API_BASE}/data/profiles`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              ...payload,
              ...savedProfile,
              extensions: targetExtensions,
              _meta: {
                ...(payload._meta || {}),
                id: savedProfile.id,
                proxy_id: boundProxyId,
                extensions: targetExtensions,
              },
              start_urls: row.parsedStartUrls,
              tags: row.parsedTags,
              folder: row.parsedFolder,
            }),
          }).catch(() => {});
        }

        row.executionStatus = "completed";
        job.completedCount++;
      } catch (err: any) {
        console.error(`[BatchImport] Error provisioning row ${row.rowIndex}:`, err);
        row.executionStatus = "failed";
        row.executionError = err?.message || String(err);
        job.failedCount++;
      }

      job.updatedAt = new Date().toISOString();
      saveActiveJob(job);
      onProgress?.(job);
    }
  };

  const poolSize = Math.min(concurrency, pendingIndices.length);
  for (let i = 0; i < poolSize; i++) {
    activeWorkers.push(worker());
  }

  await Promise.all(activeWorkers);

  if (!signal?.aborted) {
    job.status = "completed";
    job.updatedAt = new Date().toISOString();
    saveActiveJob(job);
    onProgress?.(job);
  }

  return job;
}
