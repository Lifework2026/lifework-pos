import { ProductForm } from "@/components/admin/product-form";
import { prisma } from "@/lib/prisma";
import { getStorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [categories, colors, sizes] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } }),
    prisma.color.findMany({ select: { id: true, code: true, name: true, nameTh: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.size.findMany({ select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <ProductForm
      mode="create"
      categories={categories}
      colors={colors}
      sizes={sizes.map((size) => size.name)}
      storageReady={getStorageConfig() !== null}
    />
  );
}
