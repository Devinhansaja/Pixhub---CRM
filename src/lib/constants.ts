export const STAGES = [
  { value: "new", label: "New", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { value: "researching", label: "Researching", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  { value: "contacted", label: "Contacted", color: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  { value: "interested", label: "Interested", color: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" },
  { value: "meeting_scheduled", label: "Meeting Scheduled", color: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  { value: "quotation_sent", label: "Quotation Sent", color: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { value: "negotiation", label: "Negotiation", color: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300" },
  { value: "won", label: "Won", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  { value: "lost", label: "Lost", color: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  { value: "not_interested", label: "Not Interested", color: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];
export const stageLabel = (s: string) => STAGES.find((x) => x.value === s)?.label ?? s;
export const stageColor = (s: string) => STAGES.find((x) => x.value === s)?.color ?? "";

export const OUTREACH = [
  { value: "none", label: "Not started" },
  { value: "prepared", label: "Message prepared" },
  { value: "chat_opened", label: "Chat opened (not confirmed sent)" },
  { value: "contacted", label: "Contacted (confirmed)" },
  { value: "replied", label: "Customer replied" },
  { value: "interested", label: "Interested" },
  { value: "follow_up_required", label: "Follow-up required" },
  { value: "not_interested", label: "Not interested" },
] as const;
export type OutreachStatus = (typeof OUTREACH)[number]["value"];
export const outreachLabel = (s: string) => OUTREACH.find((x) => x.value === s)?.label ?? s;

export const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "sales_manager", label: "Sales Manager" },
  { value: "sales_executive", label: "Sales Executive" },
] as const;
export type Role = (typeof ROLES)[number]["value"];
export const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

export const SL_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo", "Galle", "Gampaha", "Hambantota",
  "Jaffna", "Kalutara", "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar", "Matale",
  "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya", "Polonnaruwa", "Puttalam", "Ratnapura",
  "Trincomalee", "Vavuniya",
];

export const TZ = "Asia/Colombo";

export const PRIORITIES = [
  { value: "low", label: "Low", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  { value: "medium", label: "Medium", color: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  { value: "high", label: "High", color: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { value: "urgent", label: "Urgent", color: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
] as const;
export const priorityColor = (p: string) => PRIORITIES.find((x) => x.value === p)?.color ?? "";

export const TASK_STATUSES = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
] as const;
export const taskStatusLabel = (s: string) => TASK_STATUSES.find((x) => x.value === s)?.label ?? s;

export const QUOTATION_STATUSES = [
  { value: "draft", label: "Draft", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { value: "pending_approval", label: "Pending approval", color: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { value: "approved", label: "Approved", color: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  { value: "sent", label: "Sent", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  { value: "accepted", label: "Accepted", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  { value: "rejected", label: "Rejected", color: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  { value: "expired", label: "Expired", color: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
] as const;
export const quotationLabel = (s: string) => QUOTATION_STATUSES.find((x) => x.value === s)?.label ?? s;
export const quotationColor = (s: string) => QUOTATION_STATUSES.find((x) => x.value === s)?.color ?? "";
