"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, ScoreBadge } from "@/components/ui";
import { stageLabel } from "@/lib/constants";
import { useAction } from "@/lib/use-action";
import { cn, formatDate, formatLKR } from "@/lib/utils";
import { updateStage } from "../leads/actions";
import { moveDeal } from "./actions";

export interface BoardCard {
  id: string; company_name: string; industry: string | null; lead_score: number;
  estimated_value: number | null; next_follow_up_at: string | null;
}

export interface DealCard {
  id: string; title: string; value: number; probability: number; expected_close_date: string | null;
  contact: { id: string; company_name: string } | null; owner: { full_name: string } | null; service: { name: string } | null;
}

type Col<T> = { stage: string; cards: T[]; count: number };

function KanbanBoard<T extends { id: string }>({ columns, onMove, render, value }: {
  columns: Col<T>[];
  onMove: (id: string, stage: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  render: (card: T) => React.ReactNode;
  value: (card: T) => number;
}) {
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { run, error } = useAction();
  useEffect(() => setCols(columns), [columns]);

  const move = (cardId: string, to: string) => {
    const from = cols.find((c) => c.cards.some((x) => x.id === cardId));
    if (!from || from.stage === to) return;
    const card = from.cards.find((x) => x.id === cardId)!;
    setCols((cs) => cs.map((c) =>
      c.stage === from.stage ? { ...c, cards: c.cards.filter((x) => x.id !== cardId), count: c.count - 1 }
      : c.stage === to ? { ...c, cards: [card, ...c.cards], count: c.count + 1 } : c));
    run(() => onMove(cardId, to));
  };

  return (
    <>
      {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {cols.map((col) => {
          const total = col.cards.reduce((s, c) => s + value(c), 0);
          return (
            <div
              key={col.stage}
              onDragOver={(e) => { e.preventDefault(); setOver(col.stage); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId) move(dragId, col.stage); setDragId(null); }}
              className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-slate-100 dark:bg-slate-900/60", over === col.stage && "ring-2 ring-brand-500")}
            >
              <div className="flex items-center justify-between px-3 py-3">
                <span className="text-sm font-semibold">{stageLabel(col.stage)}</span>
                <span className="text-xs text-slate-500">{col.count}{total > 0 && ` · ${formatLKR(total)}`}</span>
              </div>
              <div className="max-h-[70vh] min-h-[120px] space-y-2 overflow-y-auto px-2 pb-2">
                {col.cards.map((c) => (
                  <div key={c.id} draggable onDragStart={() => setDragId(c.id)}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing dark:border-slate-800 dark:bg-slate-900">
                    {render(c)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function LeadBoard({ columns }: { columns: Col<BoardCard>[] }) {
  return (
    <KanbanBoard
      columns={columns}
      onMove={updateStage}
      value={(c) => Number(c.estimated_value ?? 0)}
      render={(c) => (
        <>
          <div className="flex items-start justify-between gap-2">
            <Link href={`/leads/${c.id}`} className="text-sm font-medium leading-snug hover:text-brand-600">{c.company_name}</Link>
            <ScoreBadge score={c.lead_score} />
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{c.industry ?? "—"}</p>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>{c.estimated_value ? formatLKR(c.estimated_value) : ""}</span>
            <span>{c.next_follow_up_at ? `Follow-up ${formatDate(c.next_follow_up_at)}` : ""}</span>
          </div>
        </>
      )}
    />
  );
}

export function DealBoard({ columns }: { columns: Col<DealCard>[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <KanbanBoard
      columns={columns}
      onMove={moveDeal}
      value={(c) => Number(c.value)}
      render={(c) => (
        <>
          <Link href={`/leads/${c.contact?.id}`} className="block text-sm font-medium leading-snug hover:text-brand-600">{c.title}</Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">{c.contact?.company_name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {c.service && <Badge className="bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">{c.service.name}</Badge>}
            <Badge className="tabular-nums">{c.probability}%</Badge>
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span className="font-medium text-slate-700 dark:text-slate-300">{formatLKR(c.value)}</span>
            <span className={c.expected_close_date && c.expected_close_date < today ? "text-rose-600" : ""}>
              {c.expected_close_date ? `Close ${formatDate(c.expected_close_date)}` : ""}
            </span>
          </div>
          {c.owner && <p className="mt-1 text-xs text-slate-400">{c.owner.full_name}</p>}
        </>
      )}
    />
  );
}
