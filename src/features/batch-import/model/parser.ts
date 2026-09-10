import * as XLSX from "xlsx";
import { CANONICAL_FIELDS, type ColumnMapping, type RawRow, type CanonicalField } from "./types";

export interface ParsedSheetData {
  headers: string[];
  rows: RawRow[];
  totalRows: number;
  fileName: string;
  fileSize: number;
}

/**
 * Parse an Excel (.xlsx, .xls) or CSV file into structured headers and raw rows
 */
export async function parseSpreadsheet(file: File): Promise<ParsedSheetData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellText: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Spreadsheet contains no sheets or readable data.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error("Could not read spreadsheet sheet.");
  }

  // Parse rows as objects with raw string values
  const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });

  if (rawData.length === 0) {
    throw new Error("The selected file is empty. Please provide a file with at least 1 data row.");
  }

  // Extract all distinct headers present in any row
  const headerSet = new Set<string>();
  rawData.forEach((row) => {
    Object.keys(row).forEach((k) => {
      const trimmed = k.trim();
      if (trimmed) headerSet.add(trimmed);
    });
  });

  const headers = Array.from(headerSet);

  // Normalize row keys to match trimmed headers
  const rows: RawRow[] = rawData.map((row) => {
    const normalized: RawRow = {};
    for (const h of headers) {
      normalized[h] = row[h] !== undefined ? String(row[h]).trim() : "";
    }
    return normalized;
  });

  return {
    headers,
    rows,
    totalRows: rows.length,
    fileName: file.name,
    fileSize: file.size,
  };
}

/**
 * Automatically detect likely column mappings based on known field aliases
 */
export function detectColumnMappings(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const assignedFields = new Set<CanonicalField>();

  for (const header of headers) {
    const cleanHeader = header.toLowerCase().replace(/[_\-\s]+/g, " ").trim();
    let bestMatch: CanonicalField = "ignore";

    for (const field of CANONICAL_FIELDS) {
      if (field.id === "ignore") continue;

      // Exact match on ID or Label
      if (
        cleanHeader === field.id.toLowerCase() ||
        cleanHeader === field.label.toLowerCase() ||
        field.aliases.includes(cleanHeader)
      ) {
        if (!assignedFields.has(field.id)) {
          bestMatch = field.id;
          break;
        }
      }

      // Partial / substring match
      const hasPartial = field.aliases.some(
        (alias) => cleanHeader.includes(alias) || alias.includes(cleanHeader)
      );
      if (hasPartial && !assignedFields.has(field.id) && bestMatch === "ignore") {
        bestMatch = field.id;
      }
    }

    mapping[header] = bestMatch;
    if (bestMatch !== "ignore") {
      assignedFields.add(bestMatch);
    }
  }

  return mapping;
}

/**
 * Generate a ready-to-use CSV template for batch importing profiles
 */
export function generateTemplateCsv(): string {
  const headers = [
    "Profile Title",
    "Folder",
    "Proxy (host:port:user:pass)",
    "Extensions",
    "Start URLs",
    "Timezone",
    "Tags",
    "Notes",
  ];

  const sampleRows = [
    [
      "Profile Alpha",
      "Marketing",
      "185.199.229.156:1080:user123:pass123",
      "MetaMask, Google Translate",
      "https://google.com, https://twitter.com",
      "America/New_York",
      "social, tier1",
      "Primary social media management profile",
    ],
    [
      "Profile Beta",
      "Research",
      "socks5://proxy.example.com:8080",
      "Cookiebro",
      "https://github.com",
      "auto",
      "research, dev",
      "Automated documentation crawler",
    ],
  ];

  const escapeCsv = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const csvLines = [
    headers.map(escapeCsv).join(","),
    ...sampleRows.map((row) => row.map(escapeCsv).join(",")),
  ];

  return csvLines.join("\r\n");
}
