"use server";

import { redirect } from "next/navigation";
import { getAdminSession, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";

export async function logoutAction(): Promise<void> {
  const session = await getAdminSession();
  const label = session.credentialLabel;
  const ip = await getRequestIp();
  session.destroy();
  if (label) {
    await appendAudit({ action: "auth.logout", ip, credentialLabel: label });
  }
  redirect("/admin/login");
}
