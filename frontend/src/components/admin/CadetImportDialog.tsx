import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import { toast } from "sonner";

import { queryKeys } from "@/api/query-keys";
import { importCadets } from "@/lib/admin-queries";
import type { CadetImportResult } from "@/types";

type ImportRow = Record<string, unknown>;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5_000;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted field");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function tableToRecords(table: unknown[][]): ImportRow[] {
  const [header, ...body] = table;
  if (!header) return [];
  const keys = header.map((value) => String(value ?? ""));
  return body.map((values) => normalizedRow(Object.fromEntries(keys.map((key, index) => [key, values[index] ?? ""]))));
}

function normalizedRow(row: ImportRow): ImportRow {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
    typeof value === "string" ? value.trim() : value,
  ]));
  return enrichImportRow(normalized);
}

function inferBranch(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("b.sc") || text.includes("bsc") || text.includes("nautical")) return "BSC";
  if (text.includes("b.e") || text.includes("bme") || text.includes("marine engineering")) return "BME";
  return "";
}

function enrichImportRow(row: ImportRow): ImportRow {
  const enriched = { ...row };
  if (!rowValue(enriched, "branch", "department")) {
    const branch = inferBranch(rowValue(enriched, "course"));
    if (branch) enriched.branch = branch;
  }
  if (!rowValue(enriched, "year", "current_year", "study_year")) {
    const roll = rowValue(enriched, "application_no", "roll", "roll_number");
    if (roll.includes("/2025/")) enriched.year = 1;
  }
  if (!rowValue(enriched, "batch")) {
    const roll = rowValue(enriched, "application_no", "roll", "roll_number");
    if (roll.includes("/2025/")) enriched.batch = "2025-2028 Batch 2";
  }
  return enriched;
}

function rowValue(row: ImportRow, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
  return "";
}

function validateRows(rows: ImportRow[]) {
  const rolls = new Set<string>();
  const emails = new Set<string>();
  return rows.map((row, index) => {
    const roll = rowValue(row, "roll", "roll_number", "application_no").toUpperCase();
    const name = rowValue(row, "name", "full_name");
    const email = rowValue(row, "email", "email_id").toLowerCase();
    const branch = rowValue(row, "branch", "department", "course");
    const year = Number(rowValue(row, "year", "current_year", "study_year"));
    const errors: string[] = [];
    if (!roll) errors.push("Roll Number required");
    if (!name) errors.push("Name required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Valid Email required");
    if (!branch) errors.push("Branch required");
    if (!Number.isInteger(year) || year < 1 || year > 6) errors.push("Year must be 1-6");
    if (roll && rolls.has(roll)) errors.push("Duplicate Roll Number");
    if (email && emails.has(email)) errors.push("Duplicate Email");
    rolls.add(roll);
    emails.add(email);
    return { index: index + 2, row, roll, name, email, branch, year, errors };
  });
}

export function CadetImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<CadetImportResult | null>(null);
  const preview = useMemo(() => validateRows(rows), [rows]);
  const validCount = preview.filter((item) => item.errors.length === 0).length;
  const invalidCount = rows.length - validCount;

  const mutation = useMutation({
    mutationFn: () => importCadets(rows),
    onSuccess: async (data) => {
      setResult(data);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.cadets });
      toast.success(`${data.imported} cadet${data.imported === 1 ? "" : "s"} imported`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Cadet import failed"),
  });
  const canImport = rows.length > 0 && invalidCount === 0 && !mutation.isPending;

  const selectFile = async (file?: File) => {
    if (!file) return;
    setResult(null);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Import files must be 10 MB or smaller");
      const parsed = file.name.toLowerCase().endsWith(".csv")
        ? tableToRecords(parseCsv(await file.text()))
        : tableToRecords(await readSheet(file));
      if (!parsed.length) throw new Error("The selected file contains no cadet rows");
      if (parsed.length > MAX_IMPORT_ROWS) throw new Error(`Import files may contain at most ${MAX_IMPORT_ROWS} cadets`);
      setFileName(file.name);
      setRows(parsed);
    } catch (error) {
      setRows([]);
      toast.error(error instanceof Error ? error.message : "Could not read the import file");
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-border p-4 sm:p-6">
          <div><h2 id="import-title" className="text-xl font-semibold">Bulk cadet import</h2><p className="mt-1 text-sm text-muted-foreground">Preview and validate CSV or Excel records before saving to MongoDB Atlas.</p></div>
          <button aria-label="Close import" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <input ref={inputRef} type="file" accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" onChange={(event) => void selectFile(event.target.files?.[0])} />
          <div className="mb-4 rounded-2xl border border-border bg-secondary/30 p-4 text-sm">
            <h3 className="font-semibold">Import flow</h3>
            <p className="mt-1 text-muted-foreground">Upload CSV/Excel, preview the rows, fix any required-field errors, then import. The upload button stays locked until every row has Roll Number, Name, Email, Branch, and Year.</p>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div className="rounded-xl bg-background/80 p-3"><strong className="block text-foreground">1. Required data</strong>Roll, name, email, branch, year</div>
              <div className="rounded-xl bg-background/80 p-3"><strong className="block text-foreground">2. Duplicate check</strong>File duplicates are flagged before upload</div>
              <div className="rounded-xl bg-background/80 p-3"><strong className="block text-foreground">3. MongoDB save</strong>Backend stores cadets in Atlas only</div>
            </div>
          </div>
          <button onClick={() => inputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 text-sm font-semibold hover:bg-primary/10"><Upload className="h-5 w-5" /> Choose CSV or Excel file</button>
          {fileName && <div className="mt-3 flex items-center gap-2 text-sm"><FileSpreadsheet className="h-4 w-4 text-primary" /><span className="truncate">{fileName}</span><span className="text-muted-foreground">{rows.length} rows</span></div>}

          {rows.length > 0 && <>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded-xl bg-success/10 p-3"><strong className="block text-lg text-success">{validCount}</strong>Valid</div><div className="rounded-xl bg-destructive/10 p-3"><strong className="block text-lg text-destructive">{rows.length - validCount}</strong>Invalid</div><div className="rounded-xl bg-secondary p-3"><strong className="block text-lg">{rows.length}</strong>Total</div></div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-secondary/60 uppercase text-muted-foreground"><tr><th className="p-3">Row</th><th>Roll</th><th>Name</th><th>Email</th><th>Branch</th><th>Year</th><th>Status</th></tr></thead><tbody className="divide-y divide-border">{preview.slice(0, 100).map((item) => <tr key={item.index}><td className="p-3">{item.index}</td><td>{item.roll || "-"}</td><td>{item.name || "-"}</td><td>{item.email || "-"}</td><td>{item.branch || "-"}</td><td>{item.year || "-"}</td><td className={item.errors.length ? "text-destructive" : "text-success"}>{item.errors.join(", ") || "Ready"}</td></tr>)}</tbody></table>
            </div>
            {rows.length > 100 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 100 rows. All {rows.length} rows will be validated by the backend.</p>}
            {invalidCount > 0 && <p className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">Fix all required-field errors before importing. Nothing will be uploaded while invalid rows remain.</p>}
          </>}

          {result && <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4 text-sm"><strong>Import complete:</strong> {result.imported} imported, {result.skipped} skipped, {result.failed} failed.</div>}
        </div>
        <footer className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-border bg-background p-4 sm:px-6"><button onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm">Close</button><button disabled={!canImport} onClick={() => mutation.mutate()} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50">{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Import checked rows</button></footer>
      </section>
    </div>
  );
}
