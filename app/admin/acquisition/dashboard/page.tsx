import { redirect } from "next/navigation";

export default function LegacyAcquisitionDashboardPage() {
  redirect("/admin/operations?tab=acquisition&sub=dashboard");
}
