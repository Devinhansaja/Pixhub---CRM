// WhatsApp click-to-chat helpers. Opening a link does NOT send a message:
// staff must confirm "Contacted" manually after they actually send it.

export interface TemplateVars {
  company: string;
  contact_person?: string | null;
  services?: string[];
  city?: string | null;
  sender?: string | null;
}

export function renderTemplate(body: string, v: TemplateVars): string {
  const services = v.services && v.services.length
    ? v.services.slice(0, 2).join(" and ")
    : "digital solutions";
  const map: Record<string, string> = {
    company: v.company,
    contact_person: v.contact_person?.trim() || "Sir/Madam",
    services,
    city: v.city?.trim() || "your area",
    sender: v.sender?.trim() || "the PIXhub team",
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in map ? map[key] : m));
}

/** https://wa.me/94XXXXXXXXX?text=... — only for format-valid +947 mobiles. */
export function waLink(e164Mobile: string | null | undefined, text?: string): string | null {
  if (!e164Mobile || !/^\+947\d{8}$/.test(e164Mobile)) return null;
  const base = `https://wa.me/${e164Mobile.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
