import { redirect } from "next/navigation";

export default function LegacyAcquisitionLinksPage() {
  redirect("/admin/operations?tab=acquisition&sub=links");
}
