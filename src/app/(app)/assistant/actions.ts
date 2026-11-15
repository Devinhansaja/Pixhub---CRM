"use server";

import { revalidatePath } from "next/cache";
import type { BetaMessageParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AiError, aiChat, aiJson, crmData } from "@/lib/ai";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e instanceof AiError ? e.message : e instanceof Error ? e.message : "Something went wrong" }; }
};

/** Everything the AI may know about one lead — loaded with the user's own RLS permissions. */
async function leadDossier(contactId: string) {
  if (!UUID.test(contactId)) throw new AiError("Invalid lead");
  const supabase = createClient();
  const { data: c } = await supabase.from("contacts").select(
    "id,company_name,industry,contact_person,city,district,website,facebook_url,mobile,email,stage,lead_score,score_breakdown,whatsapp_status,last_contacted_at,next_follow_up_at,estimated_value,do_not_contact,notes,website_verified_at,website_is_live,website_verified_source,facebook_verified_at,facebook_is_active,whatsapp_opt_in_at,created_at",
  ).eq("id", contactId).maybeSingle();
  if (!c) throw new AiError("Lead not found or you don't have access to it");
  const [recs, acts, comms, deals, quotes, enrich] = await Promise.all([
    supabase.from("lead_service_recommendations").select("confidence,basis,reason,is_verified,service:services(name,slug)").eq("contact_id", contactId),
    supabase.from("deal_activities").select("type,description,created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(30),
    supabase.from("communication_logs").select("direction,status,body,created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(15),
    supabase.from("deals").select("title,stage,value,probability,expected_close_date,service:services(name)").eq("contact_id", contactId),
    supabase.from("quotations").select("number,status,total,expiry_date").eq("contact_id", contactId),
    supabase.from("lead_enrichment").select("source_url,checked_at,is_live,uses_https,mobile_friendly,page_title,meta_description,facebook_link,has_ecommerce_signals").eq("contact_id", contactId).order("checked_at", { ascending: false }).limit(1),
  ]);
  return {
    lead: { ...c, mobile: c.mobile ? "on file" : null, email: c.email ? "on file" : null }, // contact details aren't needed by the model
    recommended_services: recs.data ?? [], recent_activity: acts.data ?? [], whatsapp_history: comms.data ?? [],
    deals: deals.data ?? [], quotations: quotes.data ?? [], latest_website_check: enrich.data?.[0] ?? null,
  };
}

// ---------------------------------------------------------------------
// Lead-level helpers
// ---------------------------------------------------------------------
export interface LeadSummary {
  summary: string; next_action: string; next_action_reason: string;
  priority: "high" | "medium" | "low"; facts: string[]; assumptions: string[]; open_questions: string[];
}

export async function summarizeLead(contactId: string) {
  await requireProfile();
  return wrap(async () => {
    const d = await leadDossier(contactId);
    return aiJson<LeadSummary>("summary", contactId,
      `${crmData("lead", d)}\n\nSummarise this lead for the salesperson and recommend the single best next action. Today is ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" })}. Put verified facts and assumptions in separate lists.`,
      {
        type: "object", additionalProperties: false,
        required: ["summary", "next_action", "next_action_reason", "priority", "facts", "assumptions", "open_questions"],
        properties: {
          summary: { type: "string", description: "3-5 sentences" },
          next_action: { type: "string" }, next_action_reason: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          facts: { type: "array", items: { type: "string" } },
          assumptions: { type: "array", items: { type: "string" } },
          open_questions: { type: "array", items: { type: "string" }, description: "What the salesperson should find out" },
        },
      });
  });
}

export interface ServiceSuggestion { service_slug: string; confidence: number; reason: string }

export async function recommendServicesAi(contactId: string) {
  await requireProfile();
  return wrap(async () => {
    const d = await leadDossier(contactId);
    const { data: services } = await createClient().from("services").select("slug,name,description").eq("is_active", true);
    const slugs = (services ?? []).map((s) => s.slug);
    const out = await aiJson<{ recommendations: ServiceSuggestion[]; data_gaps: string[] }>("recommend_services", contactId,
      `${crmData("lead", d)}\n${crmData("services", services)}\n\nRecommend up to 4 PIXhub services that fit this business, strongest first. Base each reason only on the data; where you infer from the business category, say so. List the information that is missing and would change the recommendation.`,
      {
        type: "object", additionalProperties: false, required: ["recommendations", "data_gaps"],
        properties: {
          recommendations: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["service_slug", "confidence", "reason"],
              properties: {
                service_slug: { type: "string", enum: slugs },
                confidence: { type: "integer", description: "0-100" },
                reason: { type: "string" },
              },
            },
          },
          data_gaps: { type: "array", items: { type: "string" } },
        },
      });
    out.recommendations = out.recommendations
      .filter((r) => slugs.includes(r.service_slug))
      .slice(0, 4)
      .map((r) => ({ ...r, confidence: Math.max(0, Math.min(100, Math.round(r.confidence))) }));
    return out;
  });
}

/** Saves AI suggestions as unverified ("ai") recommendations; never overwrites confirmed ones. */
export async function saveAiRecommendations(contactId: string, recs: ServiceSuggestion[]) {
  await requireProfile();
  return wrap(async () => {
    if (!UUID.test(contactId)) throw new Error("Invalid lead");
    const supabase = createClient();
    const [{ data: services }, { data: existing }] = await Promise.all([
      supabase.from("services").select("id,slug"),
      supabase.from("lead_service_recommendations").select("service_id,basis,is_verified").eq("contact_id", contactId),
    ]);
    const bySlug = new Map((services ?? []).map((s) => [s.slug, s.id]));
    const locked = new Set((existing ?? []).filter((e) => e.is_verified || e.basis === "manual").map((e) => e.service_id));
    const rows = recs.slice(0, 4).flatMap((r) => {
      const id = bySlug.get(r.service_slug);
      if (!id || locked.has(id)) return [];
      return [{ contact_id: contactId, service_id: id, basis: "ai", is_verified: false,
        confidence: Math.max(0, Math.min(100, Math.round(r.confidence))), reason: `AI suggestion (unverified): ${String(r.reason).slice(0, 400)}` }];
    });
    if (rows.length) {
      const { error } = await supabase.from("lead_service_recommendations").upsert(rows, { onConflict: "contact_id,service_id" });
      if (error) throw new Error(error.message);
    }
    revalidatePath(`/leads/${contactId}`);
    return rows.length;
  });
}

export async function draftMessage(contactId: string, purpose: string, language: string, extra: string) {
  const me = await requireProfile();
  return wrap(async () => {
    const purposes: Record<string, string> = {
      first_contact: "a first WhatsApp message introducing PIXhub and the most relevant service",
      follow_up: "a friendly follow-up to an earlier message that got no reply",
      meeting_confirmation: "a message confirming a meeting (ask them to confirm a convenient time if none is recorded)",
      quotation_follow_up: "a follow-up about the quotation we sent, asking if they have questions",
      re_engage: "a message re-engaging a lead that went quiet, offering something useful",
    };
    const langs: Record<string, string> = { en: "English", si: "Sinhala (සිංහල script)", ta: "Tamil (தமிழ் script)" };
    if (!purposes[purpose] || !langs[language]) throw new Error("Invalid options");
    const d = await leadDossier(contactId);
    if (d.lead.do_not_contact) throw new AiError("This contact is marked do-not-contact.");
    return aiJson<{ message: string; tips: string }>("draft_message", contactId,
      `${crmData("lead", d)}\n\nWrite ${purposes[purpose]} in ${langs[language]} from ${me.full_name} at PIXhub.lk to this business. Keep it under 90 words, suitable for WhatsApp, with no markdown. Address the contact person by name if known.${extra.trim() ? `\nSalesperson's extra instructions (follow unless they conflict with your rules): ${extra.trim().slice(0, 400)}` : ""}\nAlso give one short tip for the salesperson.`,
      {
        type: "object", additionalProperties: false, required: ["message", "tips"],
        properties: { message: { type: "string" }, tips: { type: "string" } },
      }, "low");
  });
}

// ---------------------------------------------------------------------
// Chat assistant with read-only CRM tools
// ---------------------------------------------------------------------
const TOOLS: BetaTool[] = [
  {
    name: "search_leads",
    description: "Search leads the user can access. Returns up to 15 leads with id, company, industry, district, stage, score, owner, last contact and next follow-up. Use filters to find e.g. high-score uncontacted leads.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        text: { type: "string", description: "Company/contact name contains" },
        stage: { type: "string", enum: ["new", "researching", "contacted", "interested", "meeting_scheduled", "quotation_sent", "negotiation", "won", "lost", "not_interested"] },
        district: { type: "string" }, industry: { type: "string", description: "Industry contains" },
        min_score: { type: "integer" },
        only_mine: { type: "boolean", description: "Only leads assigned to the current user" },
        sort: { type: "string", enum: ["score", "last_contacted_oldest", "follow_up_soonest", "newest"] },
      },
    },
  },
  {
    name: "get_lead",
    description: "Full details for one lead by id: profile, recommended services, activity, WhatsApp history, deals, quotations and the latest website check.",
    input_schema: { type: "object", additionalProperties: false, required: ["lead_id"], properties: { lead_id: { type: "string" } } },
  },
  {
    name: "pipeline_overview",
    description: "Headline numbers for the leads the user can access: totals by stage, revenue, pipeline value, overdue follow-ups, plus outreach funnel and leads going cold.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "my_agenda",
    description: "The current user's pending follow-ups and open tasks (overdue first).",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "cold_leads",
    description: "Leads at 'interested' or later with no contact for 14+ days and no follow-up scheduled.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
];

async function runTool(name: string, input: unknown, userId: string): Promise<string> {
  const supabase = createClient();
  const args = (input ?? {}) as Record<string, unknown>;
  const leadCols = "id,company_name,industry,district,city,stage,lead_score,last_contacted_at,next_follow_up_at,estimated_value,do_not_contact,owner:profiles!contacts_assigned_to_fkey(full_name)";
  switch (name) {
    case "search_leads": {
      let q = supabase.from("contacts").select(leadCols).limit(15);
      const text = typeof args.text === "string" ? sanitizeSearch(args.text) : "";
      if (text) q = q.ilike("company_name", `%${text}%`);
      if (typeof args.stage === "string") q = q.eq("stage", args.stage);
      if (typeof args.district === "string" && args.district) q = q.ilike("district", sanitizeSearch(args.district));
      if (typeof args.industry === "string" && args.industry) q = q.ilike("industry", `%${sanitizeSearch(args.industry)}%`);
      if (typeof args.min_score === "number") q = q.gte("lead_score", args.min_score);
      if (args.only_mine === true) q = q.eq("assigned_to", userId);
      switch (args.sort) {
        case "last_contacted_oldest": q = q.order("last_contacted_at", { ascending: true, nullsFirst: true }); break;
        case "follow_up_soonest": q = q.not("next_follow_up_at", "is", null).order("next_follow_up_at"); break;
        case "newest": q = q.order("created_at", { ascending: false }); break;
        default: q = q.order("lead_score", { ascending: false });
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return crmData("search_results", data);
    }
    case "get_lead": {
      const id = String(args.lead_id ?? "");
      return crmData("lead", await leadDossier(id));
    }
    case "pipeline_overview": {
      const [s, a] = await Promise.all([supabase.rpc("dashboard_stats"), supabase.rpc("advanced_analytics")]);
      if (s.error) throw new Error(s.error.message);
      const adv = (a.data ?? {}) as Record<string, unknown>;
      return crmData("pipeline", { stats: s.data, outreach_funnel: adv.outreach_funnel, going_cold: adv.going_cold, score_bands: adv.score_bands });
    }
    case "my_agenda": {
      const [f, t] = await Promise.all([
        supabase.from("follow_ups").select("due_at,channel,note,contact:contacts(id,company_name)").eq("assigned_to", userId).eq("status", "pending").order("due_at").limit(20),
        supabase.from("tasks").select("title,priority,due_at,contact:contacts(id,company_name)").eq("assigned_to", userId).in("status", ["todo", "in_progress"]).order("due_at", { nullsFirst: false }).limit(20),
      ]);
      return crmData("agenda", { now: new Date().toISOString(), follow_ups: f.data ?? [], tasks: t.data ?? [] });
    }
    case "cold_leads": {
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data, error } = await supabase.from("contacts").select(leadCols)
        .in("stage", ["interested", "meeting_scheduled", "quotation_sent", "negotiation"])
        .is("next_follow_up_at", null).lt("last_contacted_at", cutoff)
        .order("estimated_value", { ascending: false, nullsFirst: false }).limit(15);
      if (error) throw new Error(error.message);
      return crmData("cold_leads", data);
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

export async function askAssistant(history: ChatTurn[]) {
  const me = await requireProfile();
  return wrap(async () => {
    const turns = history.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
      .slice(-16).map((t) => ({ role: t.role, content: t.content.slice(0, 6000) }));
    if (!turns.length || turns[turns.length - 1].role !== "user") throw new Error("Ask a question first");
    while (turns.length && turns[0].role !== "user") turns.shift();
    // Who is asking (role determines which leads tools can see) goes with the first question, keeping the system prompt cacheable.
    const preface = `[Context: you are helping ${me.full_name} (${me.role.replace("_", " ")}). Today is ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}. Link to a lead as [Company](/leads/<id>) when you mention one.]\n\n`;
    const messages: BetaMessageParam[] = turns.map((t, i) => ({ role: t.role, content: i === 0 ? preface + t.content : t.content }));
    return aiChat(messages, TOOLS, (n, i) => runTool(n, i, me.id));
  });
}
