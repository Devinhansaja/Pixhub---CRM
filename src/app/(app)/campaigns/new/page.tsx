import { requireRole } from "@/lib/supabase/server";
import { aiEnabled } from "@/lib/ai";
import { PageHeader } from "@/components/ui";
import { CampaignEditor, DEFAULT_CAMPAIGN } from "../editor";
import { loadCampaignOptions } from "../options";

export default async function NewCampaignPage({ searchParams }: { searchParams: { import?: string } }) {
  await requireRole(["admin", "sales_manager"]);
  const options = await loadCampaignOptions();
  const initial = { ...DEFAULT_CAMPAIGN, audience: /^[0-9a-f-]{36}$/i.test(searchParams.import ?? "") ? { import: searchParams.import } : {} };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="New email campaign" description="Saved as a draft. It needs a manager's approval before it can start sending." />
      <CampaignEditor initial={initial} options={options} locked={false} aiAvailable={aiEnabled()} />
    </div>
  );
}
