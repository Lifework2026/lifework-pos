// prisma/seed.ts
//
// Production-safe seed. It only CREATES missing records. It never overwrites existing
// stock, prices, names or sales, so it is safe to run against a live database.
//
// Account passwords come from environment variables and are never stored in the repo:
//   ADMIN_PASSWORD, CASHIER_PASSWORD
// They are required the first time an account is created. Set them to rotate a password.

import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { ean13 } from "../lib/barcode";

const prisma = new PrismaClient();

const ACCOUNTS = [
  { username: "admin", fullName: "Lifework Admin", role: Role.ADMIN, envKey: "ADMIN_PASSWORD" },
  { username: "cashier", fullName: "Lifework Cashier", role: Role.CASHIER, envKey: "CASHIER_PASSWORD" },
] as const;

/** Thai display names. Only filled in where a row has none, so later edits are never overwritten. */
const THAI_NAMES: Record<string, string> = {
  "supplies": "วัสดุสิ้นเปลือง",
  "shopping-bag": "ถุงช้อปปิ้ง",
  "shirts": "เสื้อ",
  "pants": "กางเกง",
  "classic-oxford-shirt": "เสื้อเชิ้ตออกซ์ฟอร์ดคลาสสิก",
  "relaxed-linen-shirt": "เสื้อเชิ้ตผ้าลินินทรงหลวม",
  "slim-chino-pants": "กางเกงชิโนทรงสลิม",
  "wide-denim-jeans": "กางเกงยีนส์ขากว้าง",
};

/** Shopping bags are sold as line items, so they are ordinary variants with their own stock. */
const BAGS = [
  { sku: "BAG-SMALL", size: "Small", price: "2.00", barcode: ean13("885000900001") },
  { sku: "BAG-LARGE", size: "Large", price: "5.00", barcode: ean13("885000900002") },
];

/** Demo catalogue, created once. Existing rows are left untouched. */
const DEMO_CATALOG = [
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

async function seedAccounts(): Promise<void> {
  for (const account of ACCOUNTS) {
    const password = process.env[account.envKey];
    const existing = await prisma.user.findUnique({ where: { username: account.username }, select: { id: true } });

    if (!existing) {
      if (!password) {
        throw new Error(`${account.envKey} must be set to create the "${account.username}" account.`);
      }
      await prisma.user.create({
        data: {
          username: account.username,
          fullName: account.fullName,
          role: account.role,
          passwordHash: hashPassword(password),
        },
      });
      console.log(`Created account "${account.username}".`);
      continue;
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: account.fullName,
        role: account.role,
        isActive: true,
        ...(password ? { passwordHash: hashPassword(password) } : {}),
      },
    });
    console.log(`Updated account "${account.username}"${password ? " (password changed)" : ""}.`);
  }
}

async function fillThaiNames(): Promise<void> {
  for (const [slug, nameTh] of Object.entries(THAI_NAMES)) {
    await prisma.category.updateMany({ where: { slug, nameTh: null }, data: { nameTh } });
    await prisma.product.updateMany({ where: { slug, nameTh: null }, data: { nameTh } });
  }
}

async function seedBags(): Promise<void> {
  const category = await prisma.category.upsert({
    where: { slug: "supplies" },
    update: {},
    create: { name: "Supplies", slug: "supplies" },
  });
  await fillThaiNames();
  const product = await prisma.product.upsert({
    where: { slug: "shopping-bag" },
    update: {},
    create: {
      name: "Shopping Bag",
      slug: "shopping-bag",
      brand: "Lifework",
      description: "Carrier bag sold at checkout.",
      categoryId: category.id,
    },
  });

  for (const bag of BAGS) {
    const exists = await prisma.productVariant.findUnique({ where: { sku: bag.sku }, select: { id: true } });
    if (exists) continue;
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        size: bag.size,
        color: "Standard",
        sku: bag.sku,
        barcode: bag.barcode,
        price: bag.price,
        stockQuantity: 500,
      },
    });
    console.log(`Created ${bag.sku} with 500 units.`);
  }
}

async function seedDemoCatalog(): Promise<number> {
  let created = 0;
  let barcodeSeq = 1;

  for (const cat of DEMO_CATALOG) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: { name: cat.name, slug: cat.slug },
    });

    for (const p of cat.products) {
      const product = await prisma.product.upsert({
        where: { slug: p.slug },
        update: {},
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

        const exists = await prisma.productVariant.findUnique({
          where: { productId_size_color: { productId: product.id, size: v.size, color: v.color } },
          select: { id: true },
        });
        if (exists) continue;

        await prisma.productVariant.create({
          data: {
            productId: product.id,
            size: v.size,
            color: v.color,
            sku,
            barcode,
            price: v.price,
            stockQuantity: v.stockQuantity,
          },
        });
        created += 1;
      }
    }
  }
  return created;
}

/** Starting categories for a fashion store. Created once; rename or add more in Back-Office > Categories & sizes. */
const DEFAULT_CATEGORIES = [
  { name: "Shirts", nameTh: "เสื้อ", slug: "shirts" },
  { name: "Pants", nameTh: "กางเกง", slug: "pants" },
  { name: "Dresses", nameTh: "เดรส", slug: "dresses" },
  { name: "Outerwear", nameTh: "เสื้อคลุม", slug: "outerwear" },
  { name: "Accessories", nameTh: "เครื่องประดับ", slug: "accessories" },
];

async function seedDefaultCategories(): Promise<void> {
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { name: category.name, nameTh: category.nameTh, slug: category.slug },
    });
  }
}

/** Sizes offered in the product form. Created once; sizes already used by variants are added too, and nothing is renamed or removed. */
const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "Free Size"];

async function seedSizes(): Promise<void> {
  const used = await prisma.productVariant.findMany({ distinct: ["size"], select: { size: true } });
  const existing = await prisma.size.findMany({ select: { name: true, sortOrder: true } });
  const known = new Set(existing.map((row) => row.name.toLowerCase()));
  let order = existing.reduce((max, row) => Math.max(max, row.sortOrder), 0);

  const wanted = [...DEFAULT_SIZES, ...used.map((row) => row.size)];
  const seen = new Set<string>();
  const data: { name: string; sortOrder: number }[] = [];
  for (const name of wanted) {
    const key = name.trim().toLowerCase();
    if (!key || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    order += 1;
    data.push({ name: name.trim(), sortOrder: order });
  }
  if (data.length > 0) {
    await prisma.size.createMany({ data, skipDuplicates: true });
    console.log(`Added ${data.length} size(s) to the size list.`);
  }
}

async function main(): Promise<void> {
  await seedAccounts();
  await seedBags();
  await seedDefaultCategories();
  // The demo catalogue is sample clothing for training only. Set SEED_DEMO=1 to create it.
  const demoCreated = process.env.SEED_DEMO === "1" ? await seedDemoCatalog() : 0;
  await fillThaiNames();
  await seedSizes();

  const [users, products, variants] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
  ]);
  console.log(`Done. Demo variants created: ${demoCreated}. Totals -> users: ${users}, products: ${products}, variants: ${variants}.`);
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
