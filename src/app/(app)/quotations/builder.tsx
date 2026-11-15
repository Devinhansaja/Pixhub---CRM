"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { lineTotal, quoteTotals } from "@/lib/quote-math";
import { formatLKR, sanitizeSearch } from "@/lib/utils";
import { saveQuotation } from "./actions";

export interface Service { id: string; name: string; description: string | null; base_price: number | null }
interface Line { service_id: string; description: string; quantity: number; unit_price: number; discount_pct: number }
interface ContactLite { id: string; company_name: string; city: string | null }

export function QuoteBuilder({ initial, services, defaultTax }: {
  initial: {
    id?: string; contact: ContactLite | null; deal_id: string | null; issue_date: string; expiry_date: string;
    discount_amount: number; tax_rate: number | null; notes: string | null; items: Line[];
  };
  services: Service[];
  defaultTax: number;
}) {
  const router = useRouter();
  const [contact, setContact] = useState<ContactLite | null>(initial.contact);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ContactLite[]>([]);
  const [deals, setDeals] = useState<{ id: string; title: string }[]>([]);
  const [dealId, setDealId] = useState(initial.deal_id ?? "");
  const [issue, setIssue] = useState(initial.issue_date);
  const [expiry, setExpiry] = useState(initial.expiry_date);
  const [discount, setDiscount] = useState(initial.discount_amount);
  const [tax, setTax] = useState(initial.tax_rate ?? defaultTax);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [lines, setLines] = useState<Line[]>(initial.items.length ? initial.items : [{ service_id: "", description: "", quantity: 1, unit_price: 0, discount_pct: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Company search
  useEffect(() => {
    const q = sanitizeSearch(search);
    if (contact || q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await createClient().from("contacts").select("id,company_name,city").ilike("company_name", `%${q}%`).limit(8);
      setResults(data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, contact]);

  // Deals of the chosen company
  useEffect(() => {
    if (!contact) { setDeals([]); return; }
    createClient().from("deals").select("id,title").eq("contact_id", contact.id).not("stage", "in", "(lost,not_interested)")
      .then(({ data }) => setDeals(data ?? []));
  }, [contact]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickService = (i: number, id: string) => {
    const s = services.find((x) => x.id === id);
    setLine(i, { service_id: id, ...(s ? { description: s.name + (s.description ? ` — ${s.description}` : ""), unit_price: Number(s.base_price ?? 0) } : {}) });
  };
  const totals = quoteTotals(lines, discount, tax);

  const save = () => {
    setError(null);
    if (!contact) { setError("Choose a company"); return; }
    start(async () => {
      const res = await saveQuotation({
        id: initial.id, contact_id: contact.id, deal_id: dealId || null, issue_date: issue, expiry_date: expiry,
        discount_amount: discount, tax_rate: tax, notes,
        items: lines.map((l) => ({ ...l, service_id: l.service_id || null })),
      });
      if (res.ok) router.push(`/quotations/${res.id}`);
      else setError(res.error);
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        <CardHeader title="Customer" />
        <div className="grid gap-4 p-5 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Label>Company *</Label>
            {contact ? (
              <div className="flex h-10 items-center justify-between rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700">
                <span>{contact.company_name}{contact.city ? ` · ${contact.city}` : ""}</span>
                {!initial.id && <button className="text-xs text-brand-600" onClick={() => { setContact(null); setDealId(""); }}>Change</button>}
              </div>
            ) : (
              <>
                <Input placeholder="Search company name…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {results.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {results.map((r) => (
                      <li key={r.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setContact(r); setSearch(""); }}>{r.company_name} <span className="text-xs text-slate-400">{r.city}</span></button></li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div>
            <Label>Link to deal</Label>
            <Select value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!contact}>
              <option value="">None</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Issue date</Label><Input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></div>
            <div><Label>Valid until</Label><Input type="date" value={expiry} min={issue} onChange={(e) => setExpiry(e.target.value)} /></div>
          </div>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <CardHeader title="Items" description="Pick a service to fill in its package price, then adjust" />
        <table className="table-base">
          <thead><tr><th className="w-48">Service</th><th>Description *</th><th className="w-20">Qty</th><th className="w-36">Unit price (LKR)</th><th className="w-24">Disc. %</th><th className="w-32 text-right">Line total</th><th className="w-10" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <Select value={l.service_id} onChange={(e) => pickService(i, e.target.value)} className="h-9">
                    <option value="">Custom</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </td>
                <td><Input className="h-9" value={l.description} maxLength={500} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><Input className="h-9" type="number" min={0.01} step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></td>
                <td><Input className="h-9" type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: Number(e.target.value) })} /></td>
                <td><Input className="h-9" type="number" min={0} max={100} step="0.01" value={l.discount_pct} onChange={(e) => setLine(i, { discount_pct: Number(e.target.value) })} /></td>
                <td className="text-right tabular-nums">{formatLKR(lineTotal(l))}</td>
                <td>
                  <button disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600 disabled:opacity-30" aria-label="Remove item"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-4">
          <Button size="sm" variant="outline" disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, { service_id: "", description: "", quantity: 1, unit_price: 0, discount_pct: 0 }])}>
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <Label>Notes / terms</Label>
          <Textarea rows={6} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, delivery timeline, what's included…" />
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatLKR(totals.subtotal)}</span></div>
          <div className="flex items-center justify-between gap-4">
            <span>Discount (LKR)</span>
            <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="h-9 w-40 text-right" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Tax rate % <span className="text-xs text-slate-400">(e.g. VAT, if registered)</span></span>
            <Input type="number" min={0} max={100} step="0.01" value={tax} onChange={(e) => setTax(Number(e.target.value))} className="h-9 w-40 text-right" />
          </div>
          <div className="flex justify-between"><span>Tax</span><span className="tabular-nums">{formatLKR(totals.tax)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold dark:border-slate-700"><span>Total</span><span className="tabular-nums">{formatLKR(totals.total)}</span></div>
          {discount > totals.subtotal && <p className="text-xs text-rose-600">Discount cannot exceed the subtotal.</p>}
          <Button className="w-full" onClick={save} disabled={pending || discount > totals.subtotal}>{pending ? "Saving…" : initial.id ? "Save changes" : "Save as draft"}</Button>
        </Card>
      </div>
    </div>
  );
}
