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

/**
 * The standard colour catalogue, as the colour sheet lists it: two-digit codes 00 to 23. Names are unique, so the
 * database refuses a second colour with the same name. Items with no colour, such as shopping bags, use a Standard
 * colour that the seed creates outside this list. Client-safe.
 */
export const MATRIX_COLORS: MatrixColor[] = [
  { code: "00", name: "White", nameTh: "ขาว" },
  { code: "01", name: "Off White", nameTh: "ขาวนวล" },
  { code: "02", name: "Ivory", nameTh: "งาช้าง" },
  { code: "03", name: "Red", nameTh: "แดง" },
  { code: "04", name: "Burgundy", nameTh: "แดงเลือดหมู" },
  { code: "05", name: "Wine", nameTh: "ไวน์" },
  { code: "06", name: "Light Pink", nameTh: "ชมพูอ่อน" },
  { code: "07", name: "Pink", nameTh: "ชมพู" },
  { code: "08", name: "Coral", nameTh: "ส้มปะการัง" },
  { code: "09", name: "Orange", nameTh: "ส้ม" },
  { code: "10", name: "Beige", nameTh: "เบจ" },
  { code: "11", name: "Sand", nameTh: "ทราย" },
  { code: "12", name: "Brown", nameTh: "น้ำตาล" },
  { code: "13", name: "Yellow", nameTh: "เหลือง" },
  { code: "14", name: "Dark Beige", nameTh: "เบจเข้ม" },
  { code: "15", name: "Lime", nameTh: "เขียวมะนาว" },
  { code: "16", name: "Neon", nameTh: "นีออน" },
  { code: "17", name: "Mint", nameTh: "มินต์" },
  { code: "18", name: "Green", nameTh: "เขียว" },
  { code: "19", name: "Dark Green", nameTh: "เขียวเข้ม" },
  { code: "20", name: "Light Khaki", nameTh: "กากีอ่อน" },
  { code: "21", name: "Khaki", nameTh: "กากี" },
  { code: "22", name: "Dark Khaki", nameTh: "กากีเข้ม" },
  { code: "23", name: "Sky Blue", nameTh: "ฟ้า" },
];
