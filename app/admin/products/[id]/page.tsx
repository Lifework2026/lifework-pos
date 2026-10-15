import { notFound } from "next/navigation";
import { ProductForm, type InitialProduct } from "@/components/admin/product-form";
import { prisma } from "@/lib/prisma";
import { getStorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: { id: string } }) {
  const [product, categories, colors, sizes] = await Promise.all([
    prisma.product.findUnique({
      where: { id: params.id },
      include: { variants: { orderBy: [{ color: "asc" }, { size: "asc" }] } },
    }),
    prisma.category.findMany({ select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } }),
    prisma.color.findMany({ select: { id: true, code: true, name: true, nameTh: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.size.findMany({ select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (!product) notFound();

  const initial: InitialProduct = {
    id: product.id,
    name: product.name,
    nameTh: product.nameTh,
    brand: product.brand,
    promoTag: product.promoTag,
    description: product.description,
    categoryId: product.categoryId,
    isActive: product.isActive,
    imageUrl: product.imageUrl,
    imagePath: product.imagePath,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      colorId: variant.colorId,
      sku: variant.sku,
      barcode: variant.barcode,
      price: variant.price.toFixed(2),
      cost: variant.cost === null ? null : variant.cost.toFixed(2),
      stockQuantity: variant.stockQuantity,
      isActive: variant.isActive,
    })),
  };

  return (
    <ProductForm
      mode="edit"
      categories={categories}
      colors={colors}
      sizes={sizes.map((size) => size.name)}
      storageReady={getStorageConfig() !== null}
      initial={initial}
    />
  );
}
