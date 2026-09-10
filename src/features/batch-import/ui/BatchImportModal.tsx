import { useState, useEffect, useRef } from "react";
import { Modal, Button, ProgressBar } from "@proxyshard/shardx-ui-kit";
import {
  UploadIcon,
  DownloadIcon,
  RefreshIcon,
  PlayIcon,
  NavExtensionsIcon,
  CloseIcon,
  AddIcon,
} from "../../../shared/icons";

function SvgCheckIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SvgAlertIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
import { toast } from "../../../shared/lib/toast";
import { storeBus } from "../../../shared/lib/storeBus";
import { useProfile } from "../../../entities/profile";
import { useProxy } from "../../../entities/proxy";
import { useAuthStore } from "../../auth/model/useAuthStore";
import { useExtensions } from "../../../entities/extension";
import {
  CANONICAL_FIELDS,
  type CanonicalField,
  type ColumnMapping,
  type RowValidationResult,
  type BatchImportJob,
  type BatchExtensionConfig,
} from "../model/types";
import {
  parseSpreadsheet,
  detectColumnMappings,
  generateTemplateCsv,
  type ParsedSheetData,
} from "../model/parser";
import { validateBatchRows, resolveBatchExtensions } from "../model/validator";
import { executeBatchProvisioning } from "../model/provisioner";
import {
  loadActiveJob,
  saveActiveJob,
  clearActiveJob,
  generateErrorReportCsv,
} from "../model/jobStorage";

type ModalStep = "upload" | "mapping" | "extensions" | "preview" | "progress" | "report";

export function BatchImportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const accountId = useAuthStore((s) => s.user?.id) || "anonymous";

  const [step, setStep] = useState<ModalStep>("upload");
  const [fileData, setFileData] = useState<ParsedSheetData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [validationResults, setValidationResults] = useState<RowValidationResult[]>([]);
  const [filterTab, setFilterTab] = useState<"all" | "valid" | "errors">("all");
  const [activeJob, setActiveJob] = useState<BatchImportJob | null>(null);
  const [interruptedJob, setInterruptedJob] = useState<BatchImportJob | null>(null);

  const [isParsing, setIsParsing] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [retriedCount, setRetriedCount] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // Extensions provisioning configuration state
  const installedExtensions = useExtensions((s) => s.items);
  const extensionSets = useExtensions((s) => s.extensionSets);
  const initExtensions = useExtensions((s) => s.init);
  const saveSet = useExtensions((s) => s.saveSet);

  const [extensionConfig, setExtensionConfig] = useState<BatchExtensionConfig>({
    enabled: false,
    mode: "apply_all",
    selectedExtensionIds: [],
    selectedSetId: undefined,
    mergeWithExcel: false,
    strictMissingExtensions: false,
  });

  const [extSearch, setExtSearch] = useState("");
  const [isSaveSetModalOpen, setIsSaveSetModalOpen] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [newSetDesc, setNewSetDesc] = useState("");
  const [isSavingSetLoading, setIsSavingSetLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Check for interrupted job and load extensions on open
  useEffect(() => {
    if (open) {
      initExtensions();
      const savedJob = loadActiveJob(accountId);
      if (
        savedJob &&
        (savedJob.status === "running" || savedJob.status === "paused" || savedJob.status === "ready") &&
        savedJob.completedCount < savedJob.totalRows
      ) {
        setInterruptedJob(savedJob);
      } else {
        setInterruptedJob(null);
      }
    }
  }, [open, accountId, initExtensions]);

  // Update extension configuration and re-resolve rows dynamically
  const updateExtensionConfig = (patch: Partial<BatchExtensionConfig>) => {
    setExtensionConfig((prev) => {
      const next = { ...prev, ...patch };
      setValidationResults((curr) =>
        resolveBatchExtensions(curr, next, installedExtensions, extensionSets)
      );
      return next;
    });
  };

  // Handle file selection
  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.err("Unsupported file type. Please upload a .xlsx, .xls, or .csv file.");
      return;
    }

    setIsParsing(true);
    try {
      const parsed = await parseSpreadsheet(file);
      setFileData(parsed);

      const autoMapping = detectColumnMappings(parsed.headers);
      setMapping(autoMapping);

      const hasExtColumn =
        Object.values(autoMapping).includes("extensions") ||
        Object.values(autoMapping).includes("extension_set");

      const initialExtConfig: BatchExtensionConfig = {
        enabled: hasExtColumn,
        mode: hasExtColumn ? "excel_column" : "apply_all",
        selectedExtensionIds: [],
        selectedSetId: undefined,
        mergeWithExcel: false,
        strictMissingExtensions: false,
      };
      setExtensionConfig(initialExtConfig);

      const results = validateBatchRows(parsed.rows, autoMapping, {
        extensionConfig: initialExtConfig,
        installedExtensions,
        extensionSets,
      });
      setValidationResults(results);

      setStep("mapping");
      toast.ok(`Loaded ${parsed.totalRows} rows from "${file.name}"`);
    } catch (err: any) {
      toast.err(`Parsing failed: ${err.message || String(err)}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Re-run validation when mapping changes
  const updateMapping = (header: string, field: CanonicalField) => {
    const updated = { ...mapping, [header]: field };
    setMapping(updated);
    if (fileData) {
      const results = validateBatchRows(fileData.rows, updated, {
        extensionConfig,
        installedExtensions,
        extensionSets,
      });
      setValidationResults(results);
    }
  };

  // Quick save selection as a new Extension Set
  const handleQuickSaveSet = async () => {
    if (!newSetName.trim()) {
      toast.err("Please enter a name for the extension set");
      return;
    }
    setIsSavingSetLoading(true);
    try {
      const saved = await saveSet({
        name: newSetName.trim(),
        description: newSetDesc.trim(),
        extension_ids: extensionConfig.selectedExtensionIds,
      });
      updateExtensionConfig({
        mode: "extension_set",
        selectedSetId: saved.id,
      });
      setIsSaveSetModalOpen(false);
      setNewSetName("");
      setNewSetDesc("");
    } catch (err: any) {
      toast.err(err?.message || "Failed to save extension set");
    } finally {
      setIsSavingSetLoading(false);
    }
  };

  // Download template CSV
  const downloadTemplate = () => {
    const csvContent = generateTemplateCsv();
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "opinion_insights_profiles_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.ok("Template downloaded");
  };

  // Download error report CSV
  const downloadErrorReport = (rowsToReport = validationResults) => {
    const csvContent = generateErrorReportCsv(rowsToReport);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `import_errors_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.ok("Error report downloaded");
  };

  // Start Provisioning with re-entrancy protection
  const startProvisioning = async (jobToRun?: BatchImportJob) => {
    if (isProvisioning) return;
    setIsProvisioning(true);

    let job = jobToRun;

    if (!job) {
      if (!fileData) {
        setIsProvisioning(false);
        return;
      }
      const validRowsCount = validationResults.filter((r) => r.status === "valid").length;
      if (validRowsCount === 0) {
        toast.err("No valid rows to import. Please correct errors or check column mappings.");
        setIsProvisioning(false);
        return;
      }

      job = {
        id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        accountId,
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
        totalRows: validationResults.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rows: [...validationResults],
        status: "running",
        completedCount: 0,
        failedCount: 0,
      };
    }

    setActiveJob({ ...job });
    setStep("progress");
    abortControllerRef.current = new AbortController();

    try {
      const finalJob = await executeBatchProvisioning(job, {
        concurrency: 3,
        signal: abortControllerRef.current.signal,
        onProgress: (updated) => {
          setActiveJob({ ...updated });
        },
      });

      setActiveJob({ ...finalJob });
      if (finalJob.status === "completed") {
        setStep("report");
        useProfile.getState().reload();
        useProxy.getState().reload();
        storeBus.emit("profiles");
        clearActiveJob(accountId);
        toast.ok(`Import finished: ${finalJob.completedCount} profiles created.`);
      }
    } catch (err: any) {
      toast.err(`Batch provisioning halted: ${err.message || String(err)}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  // Retry failed rows
  const retryFailedRows = () => {
    if (!activeJob || isProvisioning) return;
    const failedRows = activeJob.rows.filter((r) => r.executionStatus === "failed");
    if (failedRows.length === 0) {
      toast.ok("No failed rows to retry.");
      return;
    }

    setRetriedCount((prev) => prev + failedRows.length);
    const retriedJob: BatchImportJob = {
      ...activeJob,
      status: "running",
      rows: activeJob.rows.map((r) => {
        if (r.executionStatus === "failed") {
          return { ...r, executionStatus: "pending", executionError: undefined };
        }
        return r;
      }),
      failedCount: 0,
      updatedAt: new Date().toISOString(),
    };
    startProvisioning(retriedJob);
  };

  // Resume interrupted job
  const resumeInterrupted = () => {
    if (interruptedJob) {
      setInterruptedJob(null);
      startProvisioning(interruptedJob);
    }
  };

  // Cancel / Pause
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (activeJob) {
      activeJob.status = "paused";
      saveActiveJob(activeJob);
    }
    useProfile.getState().reload();
    useProxy.getState().reload();
    storeBus.emit("profiles");
    onClose();
  };

  // Clean finish
  const handleDone = () => {
    clearActiveJob(accountId);
    useProfile.getState().reload();
    useProxy.getState().reload();
    storeBus.emit("profiles");
    onClose();
    resetState();
  };

  const resetState = () => {
    setStep("upload");
    setFileData(null);
    setMapping({});
    setValidationResults([]);
    setActiveJob(null);
    setInterruptedJob(null);
  };

  // Derived validation metrics
  const totalRowsCount = validationResults.length;
  const validRowsCount = validationResults.filter((r) => r.status === "valid").length;
  const invalidRowsCount = totalRowsCount - validRowsCount;

  const filteredRows = validationResults.filter((r) => {
    if (filterTab === "valid") return r.status === "valid";
    if (filterTab === "errors") return r.status === "invalid";
    return true;
  });

  const progressPct = activeJob
    ? Math.round(((activeJob.completedCount + activeJob.failedCount) / (activeJob.totalRows || 1)) * 100)
    : 0;

  return (
    <Modal
      open={open}
      onClose={step === "progress" ? handleCancel : onClose}
      maxWidthClassName="max-w-4xl"
      title={
        <div className="flex items-center gap-2">
          <UploadIcon className="size-5 text-primary-base" />
          <span className="font-semibold text-text-main">
            Batch Import Profiles (Spreadsheet Provisioning)
          </span>
        </div>
      }
      description={
        <span className="text-xs text-text-muted">
          PRD Blueprint: 1 Row = 1 Real Browser Profile with Isolated Storage & Auto Proxy
        </span>
      }
    >
      <div className="space-y-6 pt-2">
        {/* Step Indicator */}
        <div className="flex items-center justify-between border-b border-border-soft-200 pb-3 text-xs">
          {[
            { id: "upload", label: "1. Upload File" },
            { id: "mapping", label: "2. Column Mapping" },
            { id: "extensions", label: "3. Extensions" },
            { id: "preview", label: "4. Pre-Flight Preview" },
            { id: "progress", label: "5. Provisioning" },
            { id: "report", label: "6. Report" },
          ].map((s, idx) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 font-medium ${
                step === s.id
                  ? "text-primary-base font-semibold"
                  : idx < ["upload", "mapping", "extensions", "preview", "progress", "report"].indexOf(step)
                  ? "text-success-base"
                  : "text-text-muted"
              }`}
            >
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Interrupted Job Banner */}
        {interruptedJob && step === "upload" && (
          <div className="rounded-lg border border-warning-base/40 bg-warning-base/10 p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold text-warning-base">
                  <SvgAlertIcon className="size-4" />
                  <span>Interrupted Import Job Found</span>
                </div>
                <p className="text-xs text-text-muted">
                  "{interruptedJob.fileName}" was paused with{" "}
                  <strong>{interruptedJob.completedCount}</strong> of{" "}
                  <strong>{interruptedJob.totalRows}</strong> profiles created.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="small"
                  variant="neutral"
                  mode="stroke"
                  onClick={() => {
                    clearActiveJob(accountId);
                    setInterruptedJob(null);
                  }}
                >
                  Discard
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  onClick={resumeInterrupted}
                  leftIcon={<PlayIcon className="size-3.5" />}
                >
                  Resume Import
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 1: UPLOAD */}
        {step === "upload" && (
          <div className="space-y-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) handleFile(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors ${
                isDragOver
                  ? "border-primary-base bg-primary-base/5"
                  : "border-border-soft-200 hover:border-primary-base/60 bg-bg-soft-100/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <UploadIcon className="mb-3 size-10 text-primary-base/80" />
              <p className="text-sm font-medium text-text-main">
                Click to browse or drag & drop your spreadsheet
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Supports Excel (.xlsx, .xls) and CSV (.csv) files up to 10,000 rows
              </p>
              {isParsing && (
                <div className="mt-3 flex items-center gap-2 text-xs text-primary-base">
                  <RefreshIcon className="size-3.5 animate-spin" />
                  <span>Parsing rows and detecting headers...</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border-soft-200 bg-bg-soft-100/20 p-4">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-text-main">Need the standard format?</span>
                <p className="text-[11px] text-text-muted">
                  Download our pre-configured CSV template with sample profile & proxy rows.
                </p>
              </div>
              <Button
                size="small"
                variant="neutral"
                mode="stroke"
                leftIcon={<DownloadIcon className="size-3.5" />}
                onClick={downloadTemplate}
              >
                Download Template CSV
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: COLUMN MAPPING */}
        {step === "mapping" && fileData && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-text-main">
                  Map Spreadsheet Headers to Profile Fields
                </span>
                <p className="text-[11px] text-text-muted">
                  Ensure <strong>Profile Title</strong> is mapped. Other fields are optional.
                </p>
              </div>
              <span className="text-xs text-text-muted">
                File: <strong>{fileData.fileName}</strong> ({fileData.totalRows} rows)
              </span>
            </div>

            <div className="max-h-[340px] overflow-y-auto rounded-lg border border-border-soft-200 bg-bg-soft-100/30 p-2 divide-y divide-border-soft-200">
              {fileData.headers.map((header) => {
                const mappedField = mapping[header] || "ignore";
                const sampleVal = fileData.rows[0]?.[header] || "(empty)";

                const selectOptions = [
                  { label: "— Ignore this column —", value: "ignore" },
                  ...CANONICAL_FIELDS.filter((f) => f.id !== "ignore").map((f) => ({
                    label: `${f.label} ${f.required ? "(Required)" : ""}`,
                    value: f.id,
                  })),
                ];

                return (
                  <div key={header} className="flex items-center justify-between py-2.5 px-2 gap-4">
                    <div className="w-1/2">
                      <span className="text-xs font-semibold text-text-main">{header}</span>
                      <p className="truncate text-[11px] text-text-muted">
                        Sample: <span className="font-mono text-text-soft-400">{String(sampleVal)}</span>
                      </p>
                    </div>

                    <div className="w-1/2">
                      <select
                        value={mappedField}
                        onChange={(e) => updateMapping(header, e.target.value as CanonicalField)}
                        className="w-full rounded-md border border-border-soft-200 bg-bg-surface px-3 py-1.5 text-xs text-text-main focus:border-primary-base focus:outline-none"
                      >
                        {selectOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button size="small" variant="neutral" mode="stroke" onClick={() => setStep("upload")}>
                Back to Upload
              </Button>
              <Button
                size="small"
                variant="primary"
                onClick={() => {
                  const updated = resolveBatchExtensions(
                    validationResults,
                    extensionConfig,
                    installedExtensions,
                    extensionSets
                  );
                  setValidationResults(updated);
                  setStep("extensions");
                }}
                disabled={!Object.values(mapping).includes("name")}
              >
                Proceed to Extensions Configuration
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: EXTENSIONS CONFIGURATION */}
        {step === "extensions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border-soft-200 bg-bg-soft-100/30 p-3.5">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <NavExtensionsIcon className="size-4 text-primary-base" />
                  <span className="text-xs font-semibold text-text-main">
                    Extensions for Imported Profiles
                  </span>
                </div>
                <p className="text-[11px] text-text-muted">
                  Automatically provision and attach browser extensions across your imported profiles.
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-md bg-bg-surface px-3 py-1.5 border border-border-soft-200 text-xs font-medium text-text-main shadow-xs hover:bg-bg-soft-100/60 transition-colors">
                <input
                  type="checkbox"
                  checked={extensionConfig.enabled}
                  onChange={(e) => updateExtensionConfig({ enabled: e.target.checked })}
                  className="rounded border-border-soft-200 text-primary-base focus:ring-primary-base"
                />
                <span>Enable Extension Provisioning</span>
              </label>
            </div>

            {!extensionConfig.enabled ? (
              <div className="rounded-xl border border-dashed border-border-soft-200 p-8 text-center bg-bg-soft-100/20">
                <NavExtensionsIcon className="mx-auto mb-2 size-8 text-text-muted/40" />
                <p className="text-xs font-semibold text-text-main">
                  Extension provisioning is currently disabled
                </p>
                <p className="mt-1 text-[11px] text-text-muted max-w-md mx-auto">
                  Profiles will be created with default configuration only. Enable extensions to attach tools like MetaMask, translator, or ad blockers.
                </p>
                <Button
                  size="small"
                  variant="primary"
                  className="mt-3"
                  onClick={() => updateExtensionConfig({ enabled: true })}
                >
                  Enable Extensions
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 3 Modes Selector */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Mode 1 */}
                  <div
                    onClick={() => updateExtensionConfig({ mode: "apply_all" })}
                    className={`cursor-pointer rounded-lg border p-3 transition-all ${
                      extensionConfig.mode === "apply_all"
                        ? "border-primary-base bg-primary-base/5 ring-1 ring-primary-base"
                        : "border-border-soft-200 bg-bg-surface hover:border-border-soft-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ext_mode"
                        checked={extensionConfig.mode === "apply_all"}
                        onChange={() => updateExtensionConfig({ mode: "apply_all" })}
                        className="text-primary-base focus:ring-primary-base"
                      />
                      <span className="text-xs font-semibold text-text-main">
                        Same for All Profiles
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      Apply the selected extensions to every single imported profile.
                    </p>
                  </div>

                  {/* Mode 2 */}
                  <div
                    onClick={() => updateExtensionConfig({ mode: "extension_set" })}
                    className={`cursor-pointer rounded-lg border p-3 transition-all ${
                      extensionConfig.mode === "extension_set"
                        ? "border-primary-base bg-primary-base/5 ring-1 ring-primary-base"
                        : "border-border-soft-200 bg-bg-surface hover:border-border-soft-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ext_mode"
                        checked={extensionConfig.mode === "extension_set"}
                        onChange={() => updateExtensionConfig({ mode: "extension_set" })}
                        className="text-primary-base focus:ring-primary-base"
                      />
                      <span className="text-xs font-semibold text-text-main">
                        Use Extension Set
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      Use a pre-configured bundle (e.g. Research, Crypto, Automation).
                    </p>
                  </div>

                  {/* Mode 3 */}
                  <div
                    onClick={() => updateExtensionConfig({ mode: "excel_column" })}
                    className={`cursor-pointer rounded-lg border p-3 transition-all ${
                      extensionConfig.mode === "excel_column"
                        ? "border-primary-base bg-primary-base/5 ring-1 ring-primary-base"
                        : "border-border-soft-200 bg-bg-surface hover:border-border-soft-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ext_mode"
                        checked={extensionConfig.mode === "excel_column"}
                        onChange={() => updateExtensionConfig({ mode: "excel_column" })}
                        className="text-primary-base focus:ring-primary-base"
                      />
                      <span className="text-xs font-semibold text-text-main">
                        From Excel Column
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      Resolve per-row extensions from your spreadsheet column.
                    </p>
                  </div>
                </div>

                {/* Mode 1 UI: Checklist */}
                {extensionConfig.mode === "apply_all" && (
                  <div className="rounded-lg border border-border-soft-200 bg-bg-surface p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1 max-w-xs">
                        <div className="relative w-full">
                          <input
                            type="text"
                            value={extSearch}
                            onChange={(e) => setExtSearch(e.target.value)}
                            placeholder="Filter installed extensions..."
                            className="w-full rounded-md border border-border-soft-200 bg-bg-soft-100/40 px-2.5 py-1 text-xs text-text-main focus:border-primary-base focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateExtensionConfig({
                              selectedExtensionIds: installedExtensions.map((e) => e.id),
                            })
                          }
                          className="text-[11px] text-primary-base hover:underline"
                        >
                          Select All ({installedExtensions.length})
                        </button>
                        <span className="text-text-muted">·</span>
                        <button
                          type="button"
                          onClick={() =>
                            updateExtensionConfig({
                              selectedExtensionIds: [],
                            })
                          }
                          className="text-[11px] text-text-muted hover:underline"
                        >
                          Clear Selection
                        </button>
                        {extensionConfig.selectedExtensionIds.length > 0 && (
                          <Button
                            size="2xsmall"
                            variant="neutral"
                            mode="stroke"
                            leftIcon={<AddIcon className="size-3" />}
                            onClick={() => setIsSaveSetModalOpen(true)}
                          >
                            Save as Set
                          </Button>
                        )}
                      </div>
                    </div>

                    {installedExtensions.length === 0 ? (
                      <div className="py-6 text-center text-xs text-text-muted">
                        No extensions found in this account library. Add extensions via Extension Manager to use them here.
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto divide-y divide-border-soft-200 rounded border border-border-soft-200">
                        {installedExtensions
                          .filter(
                            (e) =>
                              !extSearch ||
                              e.name.toLowerCase().includes(extSearch.toLowerCase()) ||
                              e.description?.toLowerCase().includes(extSearch.toLowerCase())
                          )
                          .map((ext) => {
                            const isChecked = extensionConfig.selectedExtensionIds.includes(ext.id);
                            return (
                              <label
                                key={ext.id}
                                className={`flex cursor-pointer items-center gap-3 p-2 transition-colors ${
                                  isChecked ? "bg-primary-base/5" : "hover:bg-bg-soft-100/40"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...extensionConfig.selectedExtensionIds, ext.id]
                                      : extensionConfig.selectedExtensionIds.filter((id) => id !== ext.id);
                                    updateExtensionConfig({ selectedExtensionIds: next });
                                  }}
                                  className="rounded border-border-soft-200 text-primary-base focus:ring-primary-base"
                                />
                                {ext.icon ? (
                                  <img src={ext.icon} alt="" className="size-6 rounded object-contain shrink-0" />
                                ) : (
                                  <div className="grid size-6 shrink-0 place-items-center rounded bg-primary-base/10 text-primary-base text-[10px] font-bold">
                                    {ext.name.slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-text-main truncate">
                                      {ext.name}
                                    </span>
                                    {ext.version && (
                                      <span className="rounded bg-bg-soft-200 px-1 py-0.2 text-[9px] font-mono text-text-muted">
                                        v{ext.version}
                                      </span>
                                    )}
                                  </div>
                                  {ext.description && (
                                    <p className="truncate text-[10.5px] text-text-muted">{ext.description}</p>
                                  )}
                                </div>
                                <span className="text-[10px] text-success-base font-medium px-2 py-0.5 rounded bg-success-base/10">
                                  Installed
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}

                {/* Mode 2 UI: Extension Set */}
                {extensionConfig.mode === "extension_set" && (
                  <div className="rounded-lg border border-border-soft-200 bg-bg-surface p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-main">
                        Choose Extension Set
                      </span>
                      <Button
                        size="2xsmall"
                        variant="neutral"
                        mode="stroke"
                        leftIcon={<AddIcon className="size-3" />}
                        onClick={() => setIsSaveSetModalOpen(true)}
                      >
                        Create New Set
                      </Button>
                    </div>

                    {extensionSets.length === 0 ? (
                      <div className="rounded border border-dashed border-border-soft-200 p-6 text-center text-xs text-text-muted">
                        No Extension Sets created yet.
                        <div className="mt-2">
                          <Button
                            size="small"
                            variant="neutral"
                            mode="stroke"
                            onClick={() => setIsSaveSetModalOpen(true)}
                          >
                            Create Your First Extension Set
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <select
                          value={extensionConfig.selectedSetId || ""}
                          onChange={(e) => updateExtensionConfig({ selectedSetId: e.target.value })}
                          className="w-full rounded-md border border-border-soft-200 bg-bg-surface px-3 py-2 text-xs text-text-main focus:border-primary-base focus:outline-none"
                        >
                          <option value="">— Select an Extension Set —</option>
                          {extensionSets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.extension_ids.length} extensions)
                            </option>
                          ))}
                        </select>

                        {/* Preview Selected Set */}
                        {extensionConfig.selectedSetId && (() => {
                          const activeSet = extensionSets.find((s) => s.id === extensionConfig.selectedSetId);
                          if (!activeSet) return null;
                          return (
                            <div className="rounded-md border border-border-soft-200 bg-bg-soft-100/30 p-3 space-y-2">
                              <div className="text-xs font-semibold text-text-main flex items-center justify-between">
                                <span>{activeSet.name}</span>
                                <span className="text-[11px] text-text-muted font-normal">
                                  {activeSet.extension_ids.length} extensions included
                                </span>
                              </div>
                              {activeSet.description && (
                                <p className="text-[11px] text-text-muted">{activeSet.description}</p>
                              )}
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {activeSet.extension_ids.map((id) => {
                                  const ext = installedExtensions.find((e) => e.id === id);
                                  return (
                                    <span
                                      key={id}
                                      className="inline-flex items-center gap-1 rounded bg-primary-base/10 px-2 py-0.5 text-xs text-primary-base font-medium"
                                    >
                                      <NavExtensionsIcon className="size-3" />
                                      <span>{ext?.name || id}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Mode 3 UI: Excel Column */}
                {extensionConfig.mode === "excel_column" && (
                  <div className="rounded-lg border border-border-soft-200 bg-bg-surface p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-main">
                        Spreadsheet Column Resolution
                      </span>
                    </div>
                    {Object.values(mapping).includes("extensions") ||
                    Object.values(mapping).includes("extension_set") ? (
                      <div className="rounded-md bg-success-base/10 border border-success-base/20 p-3 text-xs text-success-base">
                        ✓ Excel column for Extensions is mapped. The engine will parse each row's comma/semicolon-separated extension names or IDs (e.g. <code>MetaMask, Google Translate</code>) and match them against your library.
                      </div>
                    ) : (
                      <div className="rounded-md bg-warning-base/10 border border-warning-base/20 p-3 text-xs text-warning-base">
                        ⚠ No column is currently mapped to <strong>Extension IDs</strong> or <strong>Extension Set</strong>. You can go back to Step 2 (Column Mapping) to map it, or choose <strong>Same for All Profiles</strong> above.
                      </div>
                    )}
                  </div>
                )}

                {/* Additional Resiliency & Fallback Controls */}
                <div className="rounded-lg border border-border-soft-200 bg-bg-soft-100/20 p-3 space-y-2.5">
                  <span className="text-xs font-semibold text-text-main">Resolution & Validation Rules</span>
                  <div className="flex flex-col gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-text-main">
                      <input
                        type="checkbox"
                        checked={extensionConfig.mergeWithExcel}
                        onChange={(e) => updateExtensionConfig({ mergeWithExcel: e.target.checked })}
                        className="rounded border-border-soft-200 text-primary-base focus:ring-primary-base"
                      />
                      <span>Merge with row-specific Excel extensions if present</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-text-main">
                      <input
                        type="checkbox"
                        checked={extensionConfig.strictMissingExtensions}
                        onChange={(e) => updateExtensionConfig({ strictMissingExtensions: e.target.checked })}
                        className="rounded border-border-soft-200 text-primary-base focus:ring-primary-base"
                      />
                      <span>Strict Mode: Mark row invalid if any requested extension is not installed</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button size="small" variant="neutral" mode="stroke" onClick={() => setStep("mapping")}>
                Back to Mapping
              </Button>
              <Button
                size="small"
                variant="primary"
                onClick={() => {
                  const updated = resolveBatchExtensions(
                    validationResults,
                    extensionConfig,
                    installedExtensions,
                    extensionSets
                  );
                  setValidationResults(updated);
                  setStep("preview");
                }}
              >
                Proceed to Pre-Flight Validation
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: PREVIEW & VALIDATION */}
        {step === "preview" && (
          <div className="space-y-4">
            {/* Metric Badges */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-border-soft-200 bg-bg-soft-100/30 p-2.5">
                <div className="text-lg font-bold text-text-main">{totalRowsCount}</div>
                <div className="text-[11px] text-text-muted">Total Spreadsheet Rows</div>
              </div>
              <div className="rounded-lg border border-success-base/30 bg-success-base/5 p-2.5">
                <div className="text-lg font-bold text-success-base">{validRowsCount}</div>
                <div className="text-[11px] text-text-muted">Valid & Ready to Provision</div>
              </div>
              <div className="rounded-lg border border-error-base/30 bg-error-base/5 p-2.5">
                <div className="text-lg font-bold text-error-base">{invalidRowsCount}</div>
                <div className="text-[11px] text-text-muted">Rows with Validation Errors</div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center justify-between border-b border-border-soft-200 pb-2">
              <div className="flex gap-1.5">
                <button
                  onClick={() => setFilterTab("all")}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${
                    filterTab === "all" ? "bg-bg-soft-200 text-text-main" : "text-text-muted"
                  }`}
                >
                  All Rows ({totalRowsCount})
                </button>
                <button
                  onClick={() => setFilterTab("valid")}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${
                    filterTab === "valid"
                      ? "bg-success-base/20 text-success-base font-semibold"
                      : "text-text-muted"
                  }`}
                >
                  Valid Only ({validRowsCount})
                </button>
                <button
                  onClick={() => setFilterTab("errors")}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${
                    filterTab === "errors"
                      ? "bg-error-base/20 text-error-base font-semibold"
                      : "text-text-muted"
                  }`}
                >
                  Errors Only ({invalidRowsCount})
                </button>
              </div>

              {invalidRowsCount > 0 && (
                <Button
                  size="2xsmall"
                  variant="neutral"
                  mode="stroke"
                  leftIcon={<DownloadIcon className="size-3" />}
                  onClick={() => downloadErrorReport()}
                >
                  Download Error CSV
                </Button>
              )}
            </div>

            {/* Preview Table */}
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border-soft-200 bg-bg-surface text-xs">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-bg-soft-100 border-b border-border-soft-200 text-text-muted">
                  <tr>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Profile Title</th>
                    <th className="py-2 px-3">Folder</th>
                    <th className="py-2 px-3">Assigned Proxy</th>
                    <th className="py-2 px-3">Assigned Extensions</th>
                    <th className="py-2 px-3">Start URLs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft-200">
                  {filteredRows.slice(0, 100).map((row) => (
                    <tr
                      key={row.rowIndex}
                      className={row.status === "invalid" ? "bg-error-base/5" : undefined}
                    >
                      <td className="py-2 px-3 font-mono text-text-muted">#{row.rowIndex}</td>
                      <td className="py-2 px-3">
                        {row.status === "valid" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-success-base/15 px-2 py-0.5 text-[10px] font-medium text-success-base">
                            <SvgCheckIcon className="size-3" /> Valid
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-error-base/15 px-2 py-0.5 text-[10px] font-medium text-error-base"
                            title={row.errors.join("; ")}
                          >
                            <SvgAlertIcon className="size-3" /> {row.errors[0]}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-medium text-text-main">{row.parsedTitle}</td>
                      <td className="py-2 px-3 text-text-muted">{row.parsedFolder || "—"}</td>
                      <td className="py-2 px-3 font-mono text-[11px]">
                        {row.parsedProxy ? (
                          <span className="text-primary-base">
                            {row.parsedProxy.host}:{row.parsedProxy.port} ({row.parsedProxy.kind})
                          </span>
                        ) : (
                          <span className="text-text-muted">Direct (No Proxy)</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {row.resolvedExtensions && row.resolvedExtensions.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[170px]">
                            {row.resolvedExtensions.map((extId) => {
                              const ext = installedExtensions.find((e) => e.id === extId);
                              return (
                                <span
                                  key={extId}
                                  title={ext ? `${ext.name} (v${ext.version})` : extId}
                                  className="inline-flex items-center gap-1 rounded bg-primary-base/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-base"
                                >
                                  <NavExtensionsIcon className="size-2.5 shrink-0" />
                                  <span className="truncate max-w-[70px]">{ext?.name || extId}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-text-muted">None</span>
                        )}
                        {row.missingExtensions && row.missingExtensions.length > 0 && (
                          <div
                            className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              extensionConfig.strictMissingExtensions
                                ? "bg-error-base/15 text-error-base"
                                : "bg-warning-base/15 text-warning-base"
                            }`}
                            title={`Missing in library: ${row.missingExtensions.join(", ")}`}
                          >
                            <SvgAlertIcon className="size-2.5" />
                            <span>{row.missingExtensions.length} missing</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text-muted truncate max-w-[140px]">
                        {row.parsedStartUrls?.join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length > 100 && (
                <div className="p-2 text-center text-xs text-text-muted border-t border-border-soft-200 bg-bg-soft-100/50">
                  Showing first 100 of {filteredRows.length} rows...
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button size="small" variant="neutral" mode="stroke" onClick={() => setStep("extensions")}>
                Back to Extensions
              </Button>
              <Button
                size="small"
                variant="primary"
                onClick={() => startProvisioning()}
                disabled={validRowsCount === 0}
                leftIcon={<PlayIcon className="size-3.5" />}
              >
                Import {validRowsCount} Valid Profile{validRowsCount === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 4: PROVISIONING IN PROGRESS */}
        {step === "progress" && activeJob && (
          <div className="space-y-6 py-4">
            <div className="space-y-2 text-center">
              <span className="text-sm font-semibold text-text-main">
                Provisioning Profiles ({progressPct}%)
              </span>
              <p className="text-xs text-text-muted">
                Creating isolated Chromium profiles and attaching row-specific proxies...
              </p>
            </div>

            <div className="space-y-2">
              <ProgressBar value={progressPct} max={100} color="primary" />
              <div className="flex justify-between text-xs text-text-muted">
                <span>
                  Completed: <strong className="text-success-base">{activeJob.completedCount}</strong>
                </span>
                <span>
                  Failed: <strong className="text-error-base">{activeJob.failedCount}</strong>
                </span>
                <span>
                  Total: <strong>{activeJob.totalRows}</strong>
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-border-soft-200 bg-bg-soft-100/30 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-mono text-text-muted">
                <RefreshIcon className="size-3.5 animate-spin text-primary-base" />
                <span>Controlled queue executing with account-partitioned storage...</span>
              </div>
            </div>

            <div className="flex justify-center gap-3">
              <Button variant="neutral" mode="stroke" size="small" onClick={handleCancel}>
                Pause / Close Window
              </Button>
            </div>
          </div>
        )}

        {/* STEP 5: FINAL REPORT */}
        {step === "report" && activeJob && (
          <div className="space-y-5">
            <div className="rounded-xl border border-success-base/40 bg-success-base/10 p-5 text-center">
              <SvgCheckIcon className="mx-auto size-8 text-success-base" />
              <h3 className="mt-2 text-base font-bold text-text-main">Batch Import Finished!</h3>
              <p className="mt-1 text-xs text-text-muted">
                Successfully created <strong>{activeJob.completedCount}</strong> real browser profiles
                with isolated directories and proxies.
              </p>
            </div>

            {/* 5 Key Metric Cards */}
            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="rounded-lg border border-border-soft-200 p-2">
                <div className="text-base font-bold text-text-main">{activeJob.totalRows}</div>
                <div className="text-[10px] text-text-muted">Total</div>
              </div>
              <div className="rounded-lg border border-success-base/30 bg-success-base/5 p-2">
                <div className="text-base font-bold text-success-base">{activeJob.completedCount}</div>
                <div className="text-[10px] text-success-base">Created</div>
              </div>
              <div className="rounded-lg border border-error-base/30 bg-error-base/5 p-2">
                <div className="text-base font-bold text-error-base">{activeJob.failedCount}</div>
                <div className="text-[10px] text-error-base">Failed</div>
              </div>
              <div className="rounded-lg border border-warning-base/30 bg-warning-base/5 p-2">
                <div className="text-base font-bold text-warning-base">
                  {activeJob.rows.filter((r) => r.status === "invalid").length}
                </div>
                <div className="text-[10px] text-warning-base">Skipped</div>
              </div>
              <div className="rounded-lg border border-primary-base/30 bg-primary-base/5 p-2">
                <div className="text-base font-bold text-primary-base">{retriedCount}</div>
                <div className="text-[10px] text-primary-base">Retried</div>
              </div>
            </div>

            {/* Per-Row Status Audit Table */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-text-main">Row Provisioning Details</div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border-soft-200 bg-bg-soft-100/20 text-xs">
                <table className="w-full text-left">
                  <thead className="sticky top-0 border-b border-border-soft-200 bg-bg-soft-100 text-[11px] text-text-muted">
                    <tr>
                      <th className="py-1.5 px-3">Row</th>
                      <th className="py-1.5 px-3">Status</th>
                      <th className="py-1.5 px-3">Profile / Outcome</th>
                      <th className="py-1.5 px-3">Proxy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft-200/50">
                    {activeJob.rows.map((row) => {
                      const isCompleted = row.executionStatus === "completed";
                      const isFailed = row.executionStatus === "failed";
                      const isInvalid = row.status === "invalid";

                      return (
                        <tr
                          key={row.rowIndex}
                          className={
                            isCompleted
                              ? "bg-success-base/5"
                              : isFailed
                              ? "bg-error-base/5"
                              : isInvalid
                              ? "bg-warning-base/5"
                              : ""
                          }
                        >
                          <td className="py-1.5 px-3 font-semibold text-text-muted whitespace-nowrap">
                            Row {row.rowIndex}
                          </td>
                          <td className="py-1.5 px-3 whitespace-nowrap">
                            {isCompleted ? (
                              <span className="inline-flex items-center gap-1 font-medium text-success-base">
                                <SvgCheckIcon className="size-3" /> Created
                              </span>
                            ) : isFailed ? (
                              <span className="inline-flex items-center gap-1 font-medium text-error-base">
                                <SvgAlertIcon className="size-3" /> Failed
                              </span>
                            ) : isInvalid ? (
                              <span className="inline-flex items-center gap-1 font-medium text-warning-base">
                                Skipped
                              </span>
                            ) : (
                              <span className="text-text-muted">Pending</span>
                            )}
                          </td>
                          <td className="py-1.5 px-3 max-w-[240px] truncate">
                            {isCompleted ? (
                              <span className="font-medium text-text-main">
                                {row.parsedTitle}{" "}
                                <span className="text-[10px] text-text-muted">
                                  ({row.createdProfileId || "created"})
                                </span>
                              </span>
                            ) : isFailed ? (
                              <span className="text-error-base">
                                {row.executionError || row.errors.join("; ") || "Execution failed"}
                              </span>
                            ) : (
                              <span className="text-warning-base">
                                {row.errors.join("; ") || "Skipped invalid row"}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-text-muted max-w-[140px] truncate">
                            {row.parsedProxy
                              ? `${row.parsedProxy.host}:${row.parsedProxy.port}`
                              : "Direct"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex gap-2">
                {activeJob.failedCount > 0 && (
                  <Button
                    size="small"
                    variant="neutral"
                    mode="stroke"
                    onClick={retryFailedRows}
                    disabled={isProvisioning}
                    leftIcon={<RefreshIcon className="size-3.5 text-warning-base" />}
                  >
                    Retry Failed Rows ({activeJob.failedCount})
                  </Button>
                )}
                {(activeJob.failedCount > 0 ||
                  activeJob.rows.some((r) => r.status === "invalid")) && (
                  <Button
                    size="small"
                    variant="neutral"
                    mode="stroke"
                    leftIcon={<DownloadIcon className="size-3.5" />}
                    onClick={() => downloadErrorReport(activeJob.rows)}
                  >
                    Export Error Report (CSV)
                  </Button>
                )}
              </div>
              <Button size="small" variant="primary" onClick={handleDone}>
                Done & Refresh Dashboard
              </Button>
            </div>
          </div>
        )}

        {/* Quick Save Extension Set Dialog */}
        {isSaveSetModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-xl bg-bg-surface p-5 shadow-2xl border border-border-soft-200 space-y-4">
              <div className="flex items-center justify-between border-b border-border-soft-200 pb-3">
                <div className="flex items-center gap-2">
                  <NavExtensionsIcon className="size-4 text-primary-base" />
                  <span className="text-sm font-semibold text-text-main">
                    Save as Extension Set
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSaveSetModalOpen(false)}
                  className="rounded p-1 text-text-muted hover:bg-bg-soft-100 hover:text-text-main transition-colors"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-text-main mb-1">Set Name *</label>
                  <input
                    type="text"
                    value={newSetName}
                    onChange={(e) => setNewSetName(e.target.value)}
                    placeholder="e.g. Research Fleet, Crypto Accounts"
                    className="w-full rounded-md border border-border-soft-200 bg-bg-surface px-3 py-2 text-xs text-text-main focus:border-primary-base focus:outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block font-medium text-text-main mb-1">Description (Optional)</label>
                  <input
                    type="text"
                    value={newSetDesc}
                    onChange={(e) => setNewSetDesc(e.target.value)}
                    placeholder="Brief description of this extension bundle"
                    className="w-full rounded-md border border-border-soft-200 bg-bg-surface px-3 py-2 text-xs text-text-main focus:border-primary-base focus:outline-none"
                  />
                </div>

                <div className="rounded-lg bg-bg-soft-100/50 p-2.5 text-text-muted text-[11px] border border-border-soft-200/60">
                  Bundle will contain <strong>{extensionConfig.selectedExtensionIds.length}</strong> selected extension{extensionConfig.selectedExtensionIds.length === 1 ? "" : "s"} and be saved to your account.
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border-soft-200">
                <Button
                  size="small"
                  variant="neutral"
                  mode="stroke"
                  onClick={() => setIsSaveSetModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  isLoading={isSavingSetLoading}
                  onClick={handleQuickSaveSet}
                  disabled={!newSetName.trim()}
                >
                  Save & Apply Set
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
