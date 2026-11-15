"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Alert, Button, Card, Input, Label, PageHeader, Select, Textarea } from "@/components/ui";
import { SL_DISTRICTS } from "@/lib/constants";
import { createLead, type ActionResult } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : "Create lead"}</Button>;
}

export default function NewLeadPage() {
  const [state, action] = useFormState<ActionResult | null, FormData>(createLead, null);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add lead" description="Duplicates (same mobile, or same name + city) are rejected automatically." />
      <Card className="p-6">
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          {state && !state.ok && <div className="sm:col-span-2"><Alert kind="error">{state.error}</Alert></div>}
          <div className="sm:col-span-2"><Label htmlFor="company_name">Company name *</Label><Input id="company_name" name="company_name" required maxLength={300} /></div>
          <div><Label htmlFor="industry">Industry / category</Label><Input id="industry" name="industry" placeholder="e.g. Restaurant" /></div>
          <div><Label htmlFor="contact_person">Contact person</Label><Input id="contact_person" name="contact_person" /></div>
          <div><Label htmlFor="mobile">Mobile</Label><Input id="mobile" name="mobile" placeholder="07X XXX XXXX" /></div>
          <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" /></div>
          <div>
            <Label htmlFor="district">District</Label>
            <Select id="district" name="district" defaultValue=""><option value="">—</option>{SL_DISTRICTS.map((d) => <option key={d}>{d}</option>)}</Select>
          </div>
          <div><Label htmlFor="city">City</Label><Input id="city" name="city" /></div>
          <div><Label htmlFor="website">Website</Label><Input id="website" name="website" /></div>
          <div><Label htmlFor="facebook_url">Facebook page</Label><Input id="facebook_url" name="facebook_url" /></div>
          <div className="sm:col-span-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" rows={3} /></div>
          <div className="sm:col-span-2"><Submit /></div>
        </form>
      </Card>
    </div>
  );
}
