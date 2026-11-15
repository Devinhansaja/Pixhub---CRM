"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bot, Loader2, Send, Trash2, User } from "lucide-react";
import { Alert, Button, Card, Textarea } from "@/components/ui";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { askAssistant, type ChatTurn } from "./actions";

const SUGGESTIONS = [
  "Which of my leads should I call today, and why?",
  "Summarise my pipeline and where deals are getting stuck.",
  "Which interested leads are going cold?",
  "Find high-score restaurants in Kandy that haven't been contacted.",
  "What should I say to a hotel that has no website?",
];

export function Chat({ model, limit }: { model: string; limit: number }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const saved = sessionStorage.getItem("pixhub-ai-chat"); if (saved) setTurns(JSON.parse(saved)); } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem("pixhub-ai-chat", JSON.stringify(turns.slice(-30))); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const next = [...turns, { role: "user" as const, content: q }];
    setTurns(next); setInput(""); setError(null);
    start(async () => {
      const res = await askAssistant(next);
      if (res.ok) setTurns([...next, { role: "assistant", content: res.data }]);
      else setError(res.error);
    });
  };

  return (
    <Card className="flex h-[calc(100vh-15rem)] min-h-[480px] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {turns.length === 0 && (
          <div className="py-6 text-center">
            <Bot className="mx-auto h-10 w-10 text-brand-600" />
            <p className="mt-3 text-sm text-slate-500">Try one of these:</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm hover:border-brand-500 hover:text-brand-600 dark:border-slate-700">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="flex gap-3">
            <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${t.role === "user" ? "bg-slate-100 dark:bg-slate-800" : "bg-brand-600 text-white"}`}>
              {t.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1 pt-1 text-sm leading-relaxed">
              {t.role === "user" ? <p className="whitespace-pre-wrap">{t.content}</p> : <SimpleMarkdown text={t.content} />}
            </div>
          </div>
        ))}
        {pending && <div className="flex items-center gap-2 pl-11 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking through the CRM…</div>}
        {error && <Alert kind="error">{error}</Alert>}
        <div ref={endRef} />
      </div>
      <form className="border-t border-slate-100 p-4 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex gap-2">
          <Textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} placeholder="Ask about leads, pipeline, next steps…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
          <div className="flex flex-col gap-2">
            <Button disabled={pending || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" disabled={pending || !turns.length} onClick={() => { setTurns([]); setError(null); }} aria-label="Clear chat"><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">Model: {model} · {limit} requests per hour per user · AI can make mistakes; check important details on the lead page.</p>
      </form>
    </Card>
  );
}
