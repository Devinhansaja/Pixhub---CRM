import { Card, PageHeader } from "@/components/ui";

/** Honest placeholder for modules scheduled in a later phase. */
export function ComingSoon({ title, phase, description, items }: { title: string; phase: 2 | 3; description: string; items: string[] }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="p-6">
        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">Not built yet — Phase {phase}</span>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          The database tables and security rules for this module already exist. The screens below are planned for Phase {phase}:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </Card>
    </>
  );
}
