import type { NameValue } from "@/components/charts";

export interface DashboardStats {
  total_leads: number; new_leads_7d: number; new_stage: number; qualified: number; contacted: number;
  interested: number; quotations_sent: number; won: number; lost: number; revenue: number;
  pipeline_value: number; valid_mobiles: number; do_not_contact: number; overdue_follow_ups: number;
  follow_ups_today: number; meetings_upcoming: number; pending_quotations: number;
  weighted_pipeline: number; open_deals: number; quotations_awaiting_approval: number;
  tasks_due_today: number; tasks_overdue: number;
}

export interface Breakdowns {
  by_stage: NameValue[];
  by_industry: NameValue[];
  by_district: NameValue[];
  by_service: NameValue[];
  by_owner: { name: string; leads: number; contacted: number; won: number; revenue: number }[];
  monthly: { month: string; new_leads: number; won: number; revenue: number }[];
  revenue_by_service: NameValue[];
  deals_by_stage: { name: string; count: number; value: number }[];
  quotations_by_status: { name: string; value: number; amount: number }[];
}

export const conversionRate = (s: DashboardStats) =>
  s.contacted > 0 ? Math.round((s.won / s.contacted) * 1000) / 10 : 0;
