import { ProductForm } from "@/components/admin/product-form";
import { prisma } from "@/lib/prisma";
import { getStorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [categories, sizes] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } }),
    prisma.size.findMany({ select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <ProductForm
      mode="create"
      categories={categories}
      sizes={sizes.map((size) => size.name)}
      storageReady={getStorageConfig() !== null}
    />
  );
}
