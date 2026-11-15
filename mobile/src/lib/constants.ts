import type { Tone } from "@/theme";

export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || "https://pixhub-crm.vercel.app";

export const STAGES: { value: string; label: string; tone: Tone }[] = [
  { value: "new", label: "New", tone: "neutral" },
  { value: "researching", label: "Researching", tone: "violet" },
  { value: "contacted", label: "Contacted", tone: "sky" },
  { value: "interested", label: "Interested", tone: "teal" },
  { value: "meeting_scheduled", label: "Meeting", tone: "violet" },
  { value: "quotation_sent", label: "Quotation Sent", tone: "warning" },
  { value: "negotiation", label: "Negotiation", tone: "orange" },
  { value: "won", label: "Won", tone: "success" },
  { value: "lost", label: "Lost", tone: "danger" },
  { value: "not_interested", label: "Not Interested", tone: "neutral" },
];
export const stageLabel = (s: string) => STAGES.find((x) => x.value === s)?.label ?? s;
export const stageTone = (s: string): Tone => STAGES.find((x) => x.value === s)?.tone ?? "neutral";
export const OPEN_STAGES = ["new", "researching", "contacted", "interested", "meeting_scheduled", "quotation_sent", "negotiation"];

export const PRIORITIES: { value: string; label: string; tone: Tone }[] = [
  { value: "low", label: "Low", tone: "neutral" },
  { value: "medium", label: "Medium", tone: "sky" },
  { value: "high", label: "High", tone: "warning" },
  { value: "urgent", label: "Urgent", tone: "danger" },
];
export const priorityTone = (p: string): Tone => PRIORITIES.find((x) => x.value === p)?.tone ?? "neutral";

export const TASK_STATUSES = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];
export const taskStatusLabel = (s: string) => TASK_STATUSES.find((x) => x.value === s)?.label ?? s;

export const QUOTATION_STATUSES: { value: string; label: string; tone: Tone }[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "pending_approval", label: "Pending approval", tone: "warning" },
  { value: "approved", label: "Approved", tone: "sky" },
  { value: "sent", label: "Sent", tone: "violet" },
  { value: "accepted", label: "Accepted", tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger" },
  { value: "expired", label: "Expired", tone: "neutral" },
];
export const quotationLabel = (s: string) => QUOTATION_STATUSES.find((x) => x.value === s)?.label ?? s;
export const quotationTone = (s: string): Tone => QUOTATION_STATUSES.find((x) => x.value === s)?.tone ?? "neutral";

export const CAMPAIGN_STATUSES: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Waiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "sky" },
  sending: { label: "Sending", tone: "primary" },
  paused: { label: "Paused", tone: "orange" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const ROLES: Record<string, string> = { admin: "Admin", sales_manager: "Sales Manager", sales_executive: "Sales Executive" };

export const FOLLOW_UP_CHANNELS = [
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "visit", label: "Visit" },
];

export const SL_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo", "Galle", "Gampaha", "Hambantota",
  "Jaffna", "Kalutara", "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar", "Matale",
  "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya", "Polonnaruwa", "Puttalam", "Ratnapura",
  "Trincomalee", "Vavuniya",
];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
