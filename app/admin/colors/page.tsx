import { ColorsManager } from "@/components/admin/colors-manager";

export const dynamic = "force-dynamic";

/** Colour master data with catalog codes. Managers only (the /admin area is guarded). */
export default function ColorsPage() {
  return <ColorsManager />;
}
