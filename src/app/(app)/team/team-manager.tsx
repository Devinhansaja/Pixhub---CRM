"use client";

import { Alert, Badge, Button, Card, CardHeader, Input, Label, Select } from "@/components/ui";
import { ROLES, roleLabel } from "@/lib/constants";
import { useAction } from "@/lib/use-action";
import { formatNumber } from "@/lib/utils";
import { inviteUser, updateMember } from "./actions";

interface Member { id: string; email: string; full_name: string; role: string; manager_id: string | null; is_active: boolean; leads: number; won: number }

export function TeamManager({ me, isAdmin, members, managers }: {
  me: string; isAdmin: boolean; members: Member[]; managers: { id: string; full_name: string }[];
}) {
  const invite = useAction();
  const edit = useAction();
  const names = new Map(managers.map((m) => [m.id, m.full_name]));

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card>
          <CardHeader title="Add employee" description="An invitation email lets them set a password. Disable public sign-ups in Supabase Auth." />
          <form className="grid gap-3 p-5 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); invite.run(() => inviteUser(fd), () => f.reset()); }}>
            <div><Label>Full name</Label><Input name="full_name" required /></div>
            <div><Label>Email</Label><Input name="email" type="email" required /></div>
            <div><Label>Role</Label><Select name="role" defaultValue="sales_executive">{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></div>
            <div><Label>Manager</Label><Select name="manager_id" defaultValue=""><option value="">None</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select></div>
            <div className="flex items-end"><Button className="w-full" disabled={invite.pending}>{invite.pending ? "Sending…" : "Send invite"}</Button></div>
          </form>
          {(invite.error || invite.message) && <div className="px-5 pb-5"><Alert kind={invite.error ? "error" : "success"}>{invite.error ?? invite.message}</Alert></div>}
        </Card>
      )}

      <Card className="overflow-x-auto">
        <CardHeader title={`Members (${members.length})`} />
        {edit.error && <div className="p-4"><Alert kind="error">{edit.error}</Alert></div>}
        <table className="table-base">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Manager</th><th className="text-right">Leads</th><th className="text-right">Won</th><th>Status</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={m.is_active ? "" : "opacity-60"}>
                <td className="font-medium">{m.full_name}{m.id === me && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                <td className="text-slate-500">{m.email}</td>
                <td>
                  {isAdmin ? (
                    <Select className="h-8 w-40" value={m.role} disabled={edit.pending} onChange={(e) => edit.run(() => updateMember(m.id, { role: e.target.value }))}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </Select>
                  ) : roleLabel(m.role)}
                </td>
                <td>
                  {isAdmin && m.role === "sales_executive" ? (
                    <Select className="h-8 w-40" value={m.manager_id ?? ""} disabled={edit.pending} onChange={(e) => edit.run(() => updateMember(m.id, { manager_id: e.target.value || null }))}>
                      <option value="">None</option>
                      {managers.filter((x) => x.id !== m.id).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                    </Select>
                  ) : (m.manager_id ? names.get(m.manager_id) ?? "—" : "—")}
                </td>
                <td className="text-right tabular-nums">{formatNumber(m.leads)}</td>
                <td className="text-right tabular-nums">{formatNumber(m.won)}</td>
                <td>
                  {isAdmin && m.id !== me ? (
                    <button disabled={edit.pending} onClick={() => edit.run(() => updateMember(m.id, { is_active: !m.is_active }))}>
                      <Badge className={m.is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}>{m.is_active ? "Active" : "Disabled"}</Badge>
                    </button>
                  ) : <Badge className={m.is_active ? "bg-emerald-50 text-emerald-700" : ""}>{m.is_active ? "Active" : "Disabled"}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
