import { redirect } from "next/navigation";

export default function LegacyRetentionPage() {
  redirect("/admin/analytics?section=retention");
}
