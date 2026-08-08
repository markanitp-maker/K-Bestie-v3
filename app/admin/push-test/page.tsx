import { redirect } from "next/navigation";

export default function LegacyPushTestPage() {
  redirect("/admin/operations?tab=push");
}
