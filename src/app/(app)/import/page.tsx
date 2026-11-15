import { requireRole, createClient } from "@/lib/supabase/server";
import { loadAssignees } from "@/lib/leads-query";
import { PageHeader } from "@/components/ui";
import { Importer } from "./importer";

export default async function ImportPage() {
  const profile = await requireRole(["admin", "sales_manager"]);
  const supabase = createClient();
  const [assignees, { data: history }] = await Promise.all([
    loadAssignees(supabase),
    supabase
      .from("lead_imports")
      .select("id,file_name,status,total_rows,inserted_rows,duplicate_rows,invalid_rows,invalid_phone_rows,created_at,finished_at,by:profiles!lead_imports_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return (
    <>
      <PageHeader
        title="Import Database"
        description="Upload Excel (.xlsx, .xls) or CSV files with thousands of business contacts. Phone numbers are normalised to +94, duplicates are skipped, and every lead is classified automatically."
      />
      <Importer
        canImport={profile.role === "admin"}
        assignees={assignees}
        history={(history ?? []) as never}
      />
    </>
  );
}
