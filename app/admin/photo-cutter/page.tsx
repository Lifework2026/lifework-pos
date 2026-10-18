import { PhotoCutter } from "@/components/admin/photo-cutter";

export const dynamic = "force-dynamic";

/** Cuts colour photos out of a product page picture. Managers only (the /admin area is guarded). */
export default function PhotoCutterPage() {
  return <PhotoCutter />;
}
