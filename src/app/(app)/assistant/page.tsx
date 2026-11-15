import { aiEnabled, AI_HOURLY_LIMIT, AI_MODEL } from "@/lib/ai";
import { requireProfile } from "@/lib/supabase/server";
import { Alert, PageHeader } from "@/components/ui";
import { Chat } from "./chat";

export default async function AssistantPage() {
  await requireProfile();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="AI Sales Assistant"
        description="Ask about your leads, pipeline and next steps. Answers use only CRM data you're allowed to see; the assistant can read, but never change, records."
      />
      {!aiEnabled() ? (
        <Alert kind="warn">
          The AI assistant is not configured. An administrator needs to add <code>ANTHROPIC_API_KEY</code> to the server environment (see README → AI assistant).
        </Alert>
      ) : (
        <Chat model={AI_MODEL} limit={AI_HOURLY_LIMIT} />
      )}
    </div>
  );
}
