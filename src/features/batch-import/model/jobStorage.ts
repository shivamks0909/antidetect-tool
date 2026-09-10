import type { BatchImportJob, RowValidationResult } from "./types";

const STORAGE_PREFIX = "oi_batch_import_job_";

export function getJobStorageKey(accountId: string): string {
  const cleanId = accountId ? accountId.trim() : "anonymous";
  return `${STORAGE_PREFIX}${cleanId}`;
}

export function saveActiveJob(job: BatchImportJob): void {
  try {
    const key = getJobStorageKey(job.accountId);
    localStorage.setItem(key, JSON.stringify(job));
  } catch (err) {
    console.warn("[BatchImport] Failed to save job to local storage:", err);
  }
}

export function loadActiveJob(accountId: string): BatchImportJob | null {
  try {
    const key = getJobStorageKey(accountId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const job: BatchImportJob = JSON.parse(raw);
    return job;
  } catch (err) {
    console.warn("[BatchImport] Failed to load job from local storage:", err);
    return null;
  }
}

export function clearActiveJob(accountId: string): void {
  try {
    const key = getJobStorageKey(accountId);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn("[BatchImport] Failed to clear job from local storage:", err);
  }
}

/**
 * Generate a CSV error report for all rows that failed validation or execution
 */
export function generateErrorReportCsv(rows: RowValidationResult[]): string {
  const failedRows = rows.filter(
    (r) => r.status === "invalid" || r.executionStatus === "failed"
  );

  if (failedRows.length === 0) {
    return "Row Number,Profile Title,Status,Errors\r\n";
  }

  // Extract all raw headers present across failed rows
  const allHeadersSet = new Set<string>();
  failedRows.forEach((r) => {
    Object.keys(r.raw).forEach((k) => allHeadersSet.add(k));
  });
  const headers = Array.from(allHeadersSet);

  const reportHeaders = ["Row Number", "Import Status", "Errors / Failure Reasons", ...headers];

  const escapeCell = (val: any): string => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    reportHeaders.map(escapeCell).join(","),
    ...failedRows.map((r) => {
      const combinedErrors = [
        ...r.errors,
        ...(r.executionError ? [r.executionError] : []),
      ].join(" | ");

      const status = r.executionStatus === "failed" ? "Execution Failed" : "Validation Failed";

      const rowValues = headers.map((h) => r.raw[h] ?? "");
      return [r.rowIndex, status, combinedErrors, ...rowValues].map(escapeCell).join(",");
    }),
  ];

  return lines.join("\r\n");
}
