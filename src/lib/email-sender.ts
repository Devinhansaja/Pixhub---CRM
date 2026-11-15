import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiEnabled, aiReviewEmail } from "@/lib/ai";
import { colomboDayStart, fillTemplate, inSendWindow, nextGapMs, toHtml, toText } from "@/lib/email-core";
import { ResendError, resendConfigured, sendViaResend } from "@/lib/resend";

interface Campaign {
  id: string; name: string; status: string; subject: string; body: string;
  followup_enabled: boolean; followup_days: number;
  followup1_subject: string | null; followup1_body: string | null; followup2_subject: string | null; followup2_body: string | null;
  daily_limit: number; min_gap_minutes: number; max_gap_minutes: number;
  send_start_hour: number; send_end_hour: number; send_days: number[];
  ai_review: boolean; max_bounce_rate: number; next_send_at: string | null; created_by: string | null;
}

export interface TickResult { campaign: string; action: string }

const PROGRESSED = ["interested", "meeting_scheduled", "quotation_sent", "negotiation", "won", "lost", "not_interested"];

async function pause(db: SupabaseClient, c: Campaign, reason: string) {
  await db.from("email_campaigns").update({ status: "paused", paused_reason: reason }).eq("id", c.id);
}

/**
 * One scheduler tick: for every campaign that is sending, inside its hours/days, under its daily limit
 * and past its random break, send (at most) one email. Called every minute by pg_cron.
 */
export async function runEmailTick(db: SupabaseClient, now = new Date()): Promise<TickResult[]> {
  const out: TickResult[] = [];
  if (!resendConfigured()) return [{ campaign: "-", action: "RESEND_API_KEY not configured" }];

  const [{ data: campaigns }, { data: settings }] = await Promise.all([
    db.from("email_campaigns").select("*").eq("status", "sending"),
    db.from("system_settings").select("value").eq("key", "email").maybeSingle(),
  ]);
  const cfg = (settings?.value ?? {}) as { from_name?: string; from_email?: string; reply_to?: string; footer?: string };
  const from = `${cfg.from_name || "PIXhub.lk"} <${process.env.EMAIL_FROM_ADDRESS || cfg.from_email || "hello@pixhub.lk"}>`;
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

  for (const c of (campaigns ?? []) as Campaign[]) {
    const label = c.name;
    if (!inSendWindow(now, c.send_start_hour, c.send_end_hour, c.send_days)) { out.push({ campaign: label, action: "outside sending hours" }); continue; }
    if (c.next_send_at && new Date(c.next_send_at) > now) { out.push({ campaign: label, action: "waiting (break)" }); continue; }
    if (c.ai_review && !aiEnabled()) { await pause(db, c, "AI review is switched on but the AI key (ANTHROPIC_API_KEY) isn't configured."); out.push({ campaign: label, action: "paused: AI not configured" }); continue; }

    const { data: stats } = await db.rpc("campaign_stats", { p_campaign: c.id });
    const s = (stats ?? {}) as Record<string, number>;
    // Auto-pause protection (keeps pixhub.lk off spam lists)
    if (s.sent >= 20 && (s.bounced / s.sent) * 100 > Number(c.max_bounce_rate)) {
      await pause(db, c, `Bounce rate ${((s.bounced / s.sent) * 100).toFixed(1)}% is above the ${c.max_bounce_rate}% limit. Clean the email list before resuming.`);
      out.push({ campaign: label, action: "auto-paused: bounces" }); continue;
    }
    if (s.complained >= 2) {
      await pause(db, c, `${s.complained} recipients marked the email as spam. Review the message before resuming.`);
      out.push({ campaign: label, action: "auto-paused: spam complaints" }); continue;
    }
    // Daily limit counts emails sent today across this campaign
    const { count: sentToday } = await db.from("email_messages").select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id).gte("sent_at", colomboDayStart(now).toISOString());
    if ((sentToday ?? 0) >= c.daily_limit) { out.push({ campaign: label, action: "daily limit reached" }); continue; }

    // Claim the next due email (atomic: only one tick can take it)
    const { data: next } = await db.from("email_messages").select("id,contact_id,step,to_email")
      .eq("campaign_id", c.id).eq("status", "queued").lte("due_at", now.toISOString())
      .order("step", { ascending: false }).order("due_at").limit(1).maybeSingle();
    if (!next) {
      const { count: remaining } = await db.from("email_messages").select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id).in("status", ["queued", "sending"]);
      if (!remaining) { await db.from("email_campaigns").update({ status: "completed" }).eq("id", c.id); out.push({ campaign: label, action: "completed" }); }
      else out.push({ campaign: label, action: "waiting for follow-ups to become due" });
      continue;
    }
    const { data: claimed } = await db.from("email_messages").update({ status: "sending" }).eq("id", next.id).eq("status", "queued").select("id");
    if (!claimed?.length) continue;

    const finish = (patch: Record<string, unknown>) => db.from("email_messages").update(patch).eq("id", next.id);
    const { data: lead } = await db.from("contacts")
      .select("id,company_name,contact_person,city,district,industry,website,stage,do_not_contact,email,email_status,unsubscribe_token,recs:lead_service_recommendations(confidence,service:services(name))")
      .eq("id", next.contact_id).maybeSingle();
    if (!lead || lead.do_not_contact || !lead.email || ["bounced", "complained"].includes(lead.email_status)) {
      await finish({ status: "skipped", error: !lead ? "Lead deleted" : lead.do_not_contact ? "Do not contact" : "No valid email" });
      out.push({ campaign: label, action: "skipped (opted out / invalid)" }); continue;
    }
    if (next.step > 0) {
      const { count: replied } = await db.from("email_messages").select("id", { count: "exact", head: true }).eq("contact_id", lead.id).eq("status", "replied");
      if (replied || PROGRESSED.includes(lead.stage)) {
        await finish({ status: "skipped", error: replied ? "Lead replied" : `Lead moved to ${lead.stage}` });
        out.push({ campaign: label, action: "follow-up skipped (lead responded)" }); continue;
      }
    }

    const tpl = next.step === 0 ? { s: c.subject, b: c.body }
      : next.step === 1 ? { s: c.followup1_subject || `Re: ${c.subject}`, b: c.followup1_body || "" }
      : { s: c.followup2_subject || `Re: ${c.subject}`, b: c.followup2_body || "" };
    if (!tpl.b.trim()) { await finish({ status: "skipped", error: "No follow-up text" }); continue; }

    const { data: owner } = c.created_by ? await db.from("profiles").select("full_name").eq("id", c.created_by).maybeSingle() : { data: null };
    const services = ((lead.recs ?? []) as unknown as { confidence: number; service: { name: string } | null }[])
      .sort((a, b) => b.confidence - a.confidence).map((r) => r.service?.name).filter(Boolean) as string[];
    const vars = { company: lead.company_name, contact_person: lead.contact_person, city: lead.city, services, sender: owner?.full_name };
    const subject = fillTemplate(tpl.s, vars).slice(0, 200);
    const body = fillTemplate(tpl.b, vars);

    if (c.ai_review) {
      try {
        const review = await aiReviewEmail(db as never, c.created_by,
          { subject, body },
          { company_name: lead.company_name, contact_person: lead.contact_person, city: lead.city, district: lead.district, industry: lead.industry, website: lead.website, recommended_services: services });
        if (!review.ok) {
          await finish({ status: "ai_rejected", subject, body, ai_review: review, error: review.issues.join("; ").slice(0, 500) });
          const { count: rejected } = await db.from("email_messages").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "ai_rejected");
          if ([1, 5, 25].includes(rejected ?? 0) && c.created_by) {
            await db.from("notifications").insert({ user_id: c.created_by, kind: "campaign", send_email: true,
              title: `AI held back ${rejected} email(s) in “${c.name}”`, body: review.issues[0] ?? "See the campaign page", link: `/campaigns/${c.id}` });
          }
          await db.from("email_campaigns").update({ next_send_at: new Date(now.getTime() + 60_000).toISOString() }).eq("id", c.id);
          out.push({ campaign: label, action: "AI held back one email" }); continue;
        }
        await finish({ ai_review: review });
      } catch (e) {
        await finish({ status: "queued" }); // try again next tick
        await pause(db, c, `AI review failed: ${e instanceof Error ? e.message : "unknown error"}. Resume when AI is available, or switch AI review off.`);
        out.push({ campaign: label, action: "paused: AI review error" }); continue;
      }
    }

    const unsubscribeUrl = `${site}/api/unsubscribe/${lead.unsubscribe_token}`;
    try {
      const id = await sendViaResend({
        from, to: lead.email, subject, replyTo: cfg.reply_to || undefined, unsubscribeUrl,
        html: toHtml(body, cfg.footer || "PIXhub.lk", unsubscribeUrl), text: toText(body, cfg.footer || "PIXhub.lk", unsubscribeUrl),
        tags: [{ name: "campaign", value: c.id }],
      });
      await finish({ status: "sent", provider_id: id, sent_at: new Date().toISOString(), subject, body, error: null });
      // Schedule the next follow-up, if any
      const nextStep = next.step + 1;
      const hasNext = c.followup_enabled && ((nextStep === 1 && c.followup1_body) || (nextStep === 2 && c.followup2_body));
      if (hasNext) {
        await db.from("email_messages").upsert({
          campaign_id: c.id, contact_id: lead.id, step: nextStep, to_email: lead.email,
          due_at: new Date(Date.now() + c.followup_days * 86_400_000).toISOString(),
        }, { onConflict: "campaign_id,contact_id,step", ignoreDuplicates: true });
      }
      out.push({ campaign: label, action: `sent to ${lead.company_name}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      await finish({ status: "failed", error: msg.slice(0, 500) });
      if (e instanceof ResendError && [401, 403, 429].includes(e.status)) {
        await pause(db, c, e.status === 429 ? "Resend rate/quota limit reached. Resume later or lower the daily limit." : `Resend rejected the request: ${msg}`);
      }
      out.push({ campaign: label, action: `failed: ${msg}` });
    }
    await db.from("email_campaigns").update({ next_send_at: new Date(now.getTime() + nextGapMs(Number(c.min_gap_minutes), Number(c.max_gap_minutes))).toISOString() }).eq("id", c.id);
  }
  return out;
}
