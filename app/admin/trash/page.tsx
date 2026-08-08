import { redirect } from "next/navigation";

export default function LegacyTrashPage() {
  redirect("/admin/operations?tab=trash");
}
