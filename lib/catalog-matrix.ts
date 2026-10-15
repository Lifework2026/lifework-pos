/**
 * The standard SKU matrix: the Catalog IDs a fashion store starts from. Codes are short and upper-case, as spreadsheets
 * use them: 00 is Short-Sleeved T-Shirt, WH is White. The seed and the sync script create these, and the hub lets the
 * user change or add more. Client-safe.
 */

export interface MatrixCategory {
  code: string;
  name: string;
  nameTh: string;
  slug: string;
}

export interface MatrixColor {
  code: string;
  name: string;
  nameTh: string;
}

export const MATRIX_CATEGORIES: MatrixCategory[] = [
  { code: "00", name: "Short-Sleeved T-Shirt", nameTh: "เสื้อยืดแขนสั้น", slug: "short-sleeved-t-shirt" },
  { code: "01", name: "Long-Sleeved T-Shirt", nameTh: "เสื้อยืดแขนยาว", slug: "long-sleeved-t-shirt" },
  { code: "02", name: "Shirt", nameTh: "เสื้อเชิ้ต", slug: "shirt" },
  { code: "03", name: "Polo Shirt", nameTh: "เสื้อโปโล", slug: "polo-shirt" },
  { code: "04", name: "Blouse", nameTh: "เสื้อเบลาส์", slug: "blouse" },
  { code: "05", name: "Pants", nameTh: "กางเกงขายาว", slug: "pants" },
  { code: "06", name: "Shorts", nameTh: "กางเกงขาสั้น", slug: "shorts" },
  { code: "07", name: "Skirt", nameTh: "กระโปรง", slug: "skirt" },
  { code: "08", name: "Dress", nameTh: "เดรส", slug: "dress" },
  { code: "09", name: "Outerwear", nameTh: "เสื้อคลุม", slug: "outerwear" },
  { code: "10", name: "Accessories", nameTh: "เครื่องประดับ", slug: "accessories" },
  { code: "SP", name: "Supplies", nameTh: "วัสดุสิ้นเปลือง", slug: "supplies" },
];

/** ST is the colour for items with no colour, such as shopping bags. */
export const MATRIX_COLORS: MatrixColor[] = [
  { code: "ST", name: "Standard", nameTh: "มาตรฐาน" },
  { code: "WH", name: "White", nameTh: "ขาว" },
  { code: "BK", name: "Black", nameTh: "ดำ" },
  { code: "GY", name: "Grey", nameTh: "เทา" },
  { code: "NV", name: "Navy", nameTh: "กรมท่า" },
  { code: "BL", name: "Blue", nameTh: "น้ำเงิน" },
  { code: "IN", name: "Indigo", nameTh: "คราม" },
  { code: "BE", name: "Beige", nameTh: "เบจ" },
  { code: "KH", name: "Khaki", nameTh: "กากี" },
  { code: "SD", name: "Sand", nameTh: "ทราย" },
  { code: "OL", name: "Olive", nameTh: "เขียวมะกอก" },
  { code: "GN", name: "Green", nameTh: "เขียว" },
  { code: "BR", name: "Brown", nameTh: "น้ำตาล" },
  { code: "RD", name: "Red", nameTh: "แดง" },
  { code: "PK", name: "Pink", nameTh: "ชมพู" },
  { code: "OR", name: "Orange", nameTh: "ส้ม" },
  { code: "YL", name: "Yellow", nameTh: "เหลือง" },
];
