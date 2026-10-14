// prisma/seed.ts
// Idempotent seed: safe to run multiple times (uses upsert on unique keys).
// Dev-only credentials are defined below; change them before any real deployment.

import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { ean13 } from "../lib/barcode";

const prisma = new PrismaClient();

const SEED_CASHIER = {
  username: "cashier",
  password: "Lifework-dev-1234",
  fullName: "Test Cashier",
  role: Role.CASHIER,
};

const SEED_ADMIN = {
  username: "admin",
  password: "Lifework-admin-1234",
  fullName: "Store Admin",
  role: Role.ADMIN,
};

interface SeedVariant {
  size: string;
  color: string;
  colorCode: string;
  price: number;
  stockQuantity: number;
}

interface SeedProduct {
  name: string;
  slug: string;
  brand: string;
  description: string;
  variants: SeedVariant[];
}

interface SeedCategory {
  name: string;
  slug: string;
  products: SeedProduct[];
}

const CATALOG: SeedCategory[] = [
  {
    name: "Shirts",
    slug: "shirts",
    products: [
      {
        name: "Classic Oxford Shirt",
        slug: "classic-oxford-shirt",
        brand: "Lifework",
        description: "Everyday cotton oxford shirt with a regular fit.",
        variants: [
          { size: "S", color: "White", colorCode: "WHT", price: 890, stockQuantity: 12 },
          { size: "M", color: "White", colorCode: "WHT", price: 890, stockQuantity: 20 },
          { size: "L", color: "White", colorCode: "WHT", price: 890, stockQuantity: 15 },
          { size: "S", color: "Blue", colorCode: "BLU", price: 890, stockQuantity: 8 },
          { size: "M", color: "Blue", colorCode: "BLU", price: 890, stockQuantity: 18 },
          { size: "L", color: "Blue", colorCode: "BLU", price: 890, stockQuantity: 10 },
        ],
      },
      {
        name: "Relaxed Linen Shirt",
        slug: "relaxed-linen-shirt",
        brand: "Lifework",
        description: "Breathable linen shirt for warm weather.",
        variants: [
          { size: "M", color: "Sand", colorCode: "SND", price: 1190, stockQuantity: 9 },
          { size: "L", color: "Sand", colorCode: "SND", price: 1190, stockQuantity: 7 },
          { size: "M", color: "Olive", colorCode: "OLV", price: 1190, stockQuantity: 5 },
        ],
      },
    ],
  },
  {
    name: "Pants",
    slug: "pants",
    products: [
      {
        name: "Slim Chino Pants",
        slug: "slim-chino-pants",
        brand: "Lifework",
        description: "Stretch cotton chinos with a tapered slim fit.",
        variants: [
          { size: "28", color: "Khaki", colorCode: "KHK", price: 1290, stockQuantity: 6 },
          { size: "30", color: "Khaki", colorCode: "KHK", price: 1290, stockQuantity: 11 },
          { size: "32", color: "Khaki", colorCode: "KHK", price: 1290, stockQuantity: 9 },
          { size: "28", color: "Black", colorCode: "BLK", price: 1290, stockQuantity: 4 },
          { size: "30", color: "Black", colorCode: "BLK", price: 1290, stockQuantity: 13 },
          { size: "32", color: "Black", colorCode: "BLK", price: 1290, stockQuantity: 8 },
        ],
      },
      {
        name: "Wide Denim Jeans",
        slug: "wide-denim-jeans",
        brand: "Lifework",
        description: "High-rise wide-leg jeans in mid-wash denim.",
        variants: [
          { size: "26", color: "Indigo", colorCode: "IND", price: 1490, stockQuantity: 3 },
          { size: "28", color: "Indigo", colorCode: "IND", price: 1490, stockQuantity: 7 },
          { size: "30", color: "Indigo", colorCode: "IND", price: 1490, stockQuantity: 5 },
        ],
      },
    ],
  },
];

async function seedUsers(): Promise<void> {
  // The cashier account was first seeded as "cashier1". Remove it only when no sales reference it.
  const legacy = await prisma.user.findUnique({
    where: { username: "cashier1" },
    select: { id: true, _count: { select: { orders: true } } },
  });
  if (legacy && legacy._count.orders === 0) {
    await prisma.user.delete({ where: { id: legacy.id } });
  }

  for (const user of [SEED_CASHIER, SEED_ADMIN]) {
    // passwordHash is updated on every run so the documented dev credentials always work.
    await prisma.user.upsert({
      where: { username: user.username },
      update: { fullName: user.fullName, role: user.role, passwordHash: hashPassword(user.password), isActive: true },
      create: {
        username: user.username,
        passwordHash: hashPassword(user.password),
        fullName: user.fullName,
        role: user.role,
      },
    });
  }
}

async function seedCatalog(): Promise<number> {
  let barcodeSeq = 1;
  let variantCount = 0;

  for (const cat of CATALOG) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: { name: cat.name, slug: cat.slug },
    });

    for (const p of cat.products) {
      const product = await prisma.product.upsert({
        where: { slug: p.slug },
        update: {
          name: p.name,
          brand: p.brand,
          description: p.description,
          categoryId: category.id,
        },
        create: {
          name: p.name,
          slug: p.slug,
          brand: p.brand,
          description: p.description,
          categoryId: category.id,
        },
      });

      for (const v of p.variants) {
        const sku = `${p.slug.toUpperCase().replace(/-/g, "").slice(0, 8)}-${v.colorCode}-${v.size}`;
        const barcode = ean13(`885000${String(barcodeSeq).padStart(6, "0")}`);
        barcodeSeq += 1;

        await prisma.productVariant.upsert({
          where: {
            productId_size_color: {
              productId: product.id,
              size: v.size,
              color: v.color,
            },
          },
          update: {
            sku,
            barcode,
            price: v.price,
            stockQuantity: v.stockQuantity,
          },
          create: {
            productId: product.id,
            size: v.size,
            color: v.color,
            sku,
            barcode,
            price: v.price,
            stockQuantity: v.stockQuantity,
          },
        });
        variantCount += 1;
      }
    }
  }

  return variantCount;
}

async function main(): Promise<void> {
  console.log("Seeding users...");
  await seedUsers();

  console.log("Seeding categories, products and variants...");
  const variantCount = await seedCatalog();

  const [categories, products, variants, users] = await Promise.all([
    prisma.category.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.user.count(),
  ]);

  console.log(
    `Done. Upserted ${variantCount} variants. Totals -> categories: ${categories}, products: ${products}, variants: ${variants}, users: ${users}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
