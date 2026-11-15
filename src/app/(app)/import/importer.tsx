"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Label, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { CRM_FIELDS, dedupeKey, detectMapping, prepareRow, type Mapping, type PreparedRow, type RowIssue } from "@/lib/import-mapping";
import { formatPhone } from "@/lib/phone";
import { formatDate, formatNumber } from "@/lib/utils";

const BATCH = 500;

interface HistoryRow {
  id: string; file_name: string; status: string; total_rows: number; inserted_rows: number; duplicate_rows: number;
  invalid_rows: number; invalid_phone_rows: number; created_at: string; by: { full_name: string } | null;
}

type Raw = Record<string, unknown>;

export function Importer({ canImport, assignees, history }: {
  canImport: boolean; assignees: { id: string; full_name: string }[]; history: HistoryRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<{ name: string; rows: Raw[]; headers: string[] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [assignTo, setAssignTo] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; inserted: number; duplicates: number; failed: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastImportId, setLastImportId] = useState<string | null>(null);

  const sheet = sheets[sheetIdx];

  async function onFile(f: File) {
    setError(null); setResult(null); setProgress(null); setParsing(true);
    try {
      if (f.size > 60 * 1024 * 1024) throw new Error("File is larger than 60 MB. Split it into smaller files.");
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const parsed = wb.SheetNames.map((name) => {
        const rows = XLSX.utils.sheet_to_json<Raw>(wb.Sheets[name], { defval: "", raw: false });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        return { name, rows, headers };
      }).filter((s) => s.rows.length > 0);
      if (!parsed.length) throw new Error("No data rows found in this file.");
      setFileName(f.name);
      setSheets(parsed);
      setSheetIdx(0);
      setMapping(detectMapping(parsed[0].headers));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file");
    } finally {
      setParsing(false);
    }
  }

  // Validate every row (fast, client-side) for the preview & statistics
  const analysis = useMemo(() => {
    if (!sheet || !mapping.company_name) return null;
    const prepared: PreparedRow[] = [];
    const issues: Record<RowIssue, number> = { missing_company: 0, invalid_phone: 0, no_phone: 0, invalid_email: 0 };
    const seen = new Set<string>();
    let fileDuplicates = 0;
    let validMobiles = 0;
    for (const raw of sheet.rows) {
      const { row, issues: iss } = prepareRow(raw, mapping);
      iss.forEach((i) => issues[i]++);
      if (!row) continue;
      const key = dedupeKey(row);
      if (seen.has(key)) { fileDuplicates++; continue; }
      seen.add(key);
      if (row.mobile) validMobiles++;
      prepared.push(row);
    }
    return { prepared, issues, fileDuplicates, validMobiles };
  }, [sheet, mapping]);

  async function runImport() {
    if (!analysis || !sheet) return;
    const supabase = createClient();
    setRunning(true); setError(null); setResult(null); cancelRef.current = false;
    const rows = analysis.prepared;
    const prog = { done: 0, total: rows.length, inserted: 0, duplicates: analysis.fileDuplicates, failed: 0 };
    setProgress({ ...prog });
    const errors: { row: string; error: string }[] = [];

    const { data: imp, error: impErr } = await supabase
      .from("lead_imports")
      .insert({
        file_name: fileName.slice(0, 200),
        total_rows: sheet.rows.length,
        column_mapping: mapping,
        invalid_rows: analysis.issues.missing_company,
        invalid_phone_rows: analysis.issues.invalid_phone,
      })
      .select("id")
      .single();
    if (impErr || !imp) {
      setError(impErr?.message ?? "Could not start import");
      setRunning(false);
      return;
    }

    const toRecord = (r: PreparedRow) => ({ ...r, import_id: imp.id, assigned_to: assignTo || null });

    for (let i = 0; i < rows.length; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = rows.slice(i, i + BATCH);
      let ids: string[] = [];
      const { data, error: insErr } = await supabase
        .from("contacts")
        .upsert(chunk.map(toRecord), { onConflict: "dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (insErr) {
        // Retry one by one so a single bad row doesn't drop the whole batch
        for (const r of chunk) {
          const res = await supabase.from("contacts").upsert(toRecord(r), { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
          if (res.error) {
            prog.failed++;
            if (errors.length < 100) errors.push({ row: r.company_name, error: res.error.message });
          } else if (res.data?.length) ids.push(res.data[0].id);
          else prog.duplicates++;
        }
      } else {
        ids = (data ?? []).map((d) => d.id);
        prog.duplicates += chunk.length - ids.length;
      }
      prog.inserted += ids.length;
      if (ids.length) {
        const cls = await supabase.rpc("classify_contacts", { p_ids: ids });
        if (cls.error && errors.length < 100) errors.push({ row: `batch ${i / BATCH + 1}`, error: `Classification: ${cls.error.message}` });
      }
      prog.done = Math.min(i + BATCH, rows.length);
      setProgress({ ...prog });
    }

    const cancelled = cancelRef.current;
    await supabase.from("lead_imports").update({
      status: cancelled ? "cancelled" : "completed",
      inserted_rows: prog.inserted,
      duplicate_rows: prog.duplicates,
      invalid_rows: analysis.issues.missing_company + prog.failed,
      errors,
      finished_at: new Date().toISOString(),
    }).eq("id", imp.id);

    setRunning(false);
    setResult(
      `${cancelled ? "Import cancelled" : "Import complete"}: ${formatNumber(prog.inserted)} new leads, ${formatNumber(prog.duplicates)} duplicates skipped, ${formatNumber(analysis.issues.missing_company + prog.failed)} invalid rows.` +
      (errors.length ? ` First error: ${errors[0].error}` : ""),
    );
    setLastImportId(imp.id);
    router.refresh();
  }

  const reset = () => { setSheets([]); setFileName(""); setMapping({}); setProgress(null); setResult(null); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="space-y-6">
      {!canImport && <Alert kind="info">Only administrators can run imports. You can view import history below.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {result && (
        <Alert kind="success">
          {result}
          {lastImportId && (
            <Link href={`/leads?import=${lastImportId}`} className="ml-2 font-semibold underline">View & filter these leads →</Link>
          )}
        </Alert>
      )}

      {canImport && !sheet && (
        <Card
          className="flex cursor-pointer flex-col items-center justify-center border-2 border-dashed p-12 text-center hover:border-brand-500"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        >
          {parsing ? <Loader2 className="h-10 w-10 animate-spin text-brand-600" /> : <Upload className="h-10 w-10 text-brand-600" />}
          <p className="mt-3 font-medium">{parsing ? "Reading file…" : "Drop an Excel or CSV file here, or click to browse"}</p>
          <p className="mt-1 text-sm text-slate-500">Supports .xlsx, .xls and .csv — 100,000+ rows</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </Card>
      )}

      {sheet && (
        <>
          <Card>
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> {fileName}</span>}
              description={`${formatNumber(sheet.rows.length)} rows · ${sheet.headers.length} columns`}
              action={<Button size="sm" variant="ghost" onClick={reset} disabled={running}>Choose another file</Button>}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {sheets.length > 1 && (
                <div>
                  <Label>Sheet</Label>
                  <Select value={sheetIdx} disabled={running} onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); setMapping(detectMapping(sheets[i].headers)); }}>
                    {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length})</option>)}
                  </Select>
                </div>
              )}
              {CRM_FIELDS.map((f) => (
                <div key={f.key}>
                  <Label>{f.label}{"required" in f && f.required ? " *" : ""}</Label>
                  <Select
                    value={mapping[f.key] ?? ""}
                    disabled={running}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                  >
                    <option value="">— Not mapped —</option>
                    {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              ))}
              <div>
                <Label>Assign imported leads to</Label>
                <Select value={assignTo} disabled={running} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">Leave unassigned</option>
                  {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </Select>
              </div>
            </div>
          </Card>

          {!mapping.company_name && <Alert kind="warn">Map the Company Name column to continue.</Alert>}

          {analysis && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Ready to import" value={analysis.prepared.length} />
                <Stat label="Valid mobiles" value={analysis.validMobiles} />
                <Stat label="Duplicates in file" value={analysis.fileDuplicates} warn />
                <Stat label="Invalid phone numbers" value={analysis.issues.invalid_phone} warn />
                <Stat label="No phone" value={analysis.issues.no_phone} />
                <Stat label="Missing company (skipped)" value={analysis.issues.missing_company} warn />
              </div>
              <Alert kind="info">
                A valid mobile means the number <em>format</em> is correct. It does not confirm the number has WhatsApp.
                Leads already in the CRM (same mobile, or same name + city) are skipped automatically.
              </Alert>

              <Card className="overflow-x-auto">
                <CardHeader title="Preview" description="First 15 rows after normalisation" />
                <table className="table-base">
                  <thead><tr><th>Company</th><th>Industry</th><th>Contact</th><th>Mobile</th><th>Landline</th><th>Email</th><th>District</th><th>City</th><th>Website</th></tr></thead>
                  <tbody>
                    {analysis.prepared.slice(0, 15).map((r, i) => (
                      <tr key={i}>
                        <td className="font-medium">{r.company_name}</td>
                        <td>{r.industry ?? "—"}</td>
                        <td>{r.contact_person ?? "—"}</td>
                        <td className="whitespace-nowrap">{r.mobile ? formatPhone(r.mobile) : r.mobile_raw ? <Badge className="bg-rose-50 text-rose-700">invalid: {r.mobile_raw}</Badge> : "—"}</td>
                        <td className="whitespace-nowrap">{formatPhone(r.landline) || "—"}</td>
                        <td>{r.email ?? "—"}</td>
                        <td>{r.district ?? "—"}</td>
                        <td>{r.city ?? "—"}</td>
                        <td className="max-w-[180px] truncate">{r.website ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card className="p-5">
                {progress && (
                  <div className="mb-4">
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{formatNumber(progress.done)} / {formatNumber(progress.total)} processed</span>
                      <span className="text-slate-500">{formatNumber(progress.inserted)} new · {formatNumber(progress.duplicates)} duplicates · {formatNumber(progress.failed)} failed</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button onClick={runImport} disabled={running || !canImport || analysis.prepared.length === 0}>
                    {running && <Loader2 className="h-4 w-4 animate-spin" />}
                    {running ? "Importing…" : `Import ${formatNumber(analysis.prepared.length)} leads`}
                  </Button>
                  {running && <Button variant="outline" onClick={() => { cancelRef.current = true; }}>Cancel</Button>}
                </div>
                {running && <p className="mt-2 text-xs text-slate-500">Keep this tab open until the import finishes.</p>}
              </Card>
            </>
          )}
        </>
      )}

      <Card className="overflow-x-auto">
        <CardHeader title="Import history" />
        <table className="table-base">
          <thead><tr><th>File</th><th>Status</th><th className="text-right">Rows</th><th className="text-right">New</th><th className="text-right">Duplicates</th><th className="text-right">Invalid</th><th className="text-right">Bad phones</th><th>By</th><th>Date</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-slate-500">No imports yet.</td></tr>}
            {history.map((h) => (
              <tr key={h.id}>
                <td className="font-medium">
                  {h.file_name}
                  {h.inserted_rows > 0 && <Link href={`/leads?import=${h.id}`} className="ml-2 text-xs font-normal text-brand-600 hover:underline">View leads →</Link>}
                </td>
                <td><Badge className={h.status === "completed" ? "bg-emerald-50 text-emerald-700" : h.status === "processing" ? "bg-amber-50 text-amber-700" : ""}>{h.status}</Badge></td>
                <td className="text-right tabular-nums">{formatNumber(h.total_rows)}</td>
                <td className="text-right tabular-nums">{formatNumber(h.inserted_rows)}</td>
                <td className="text-right tabular-nums">{formatNumber(h.duplicate_rows)}</td>
                <td className="text-right tabular-nums">{formatNumber(h.invalid_rows)}</td>
                <td className="text-right tabular-nums">{formatNumber(h.invalid_phone_rows)}</td>
                <td>{h.by?.full_name ?? "—"}</td>
                <td className="whitespace-nowrap">{formatDate(h.created_at, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${warn && value > 0 ? "text-amber-600" : ""}`}>{formatNumber(value)}</p>
    </Card>
  );
}
