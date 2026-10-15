/**
 * The starter SKU matrix: the Catalog IDs the Master Data hub begins with. The seed creates these, and the hub guides
 * the user to add their own. Codes are short and upper-case, as spreadsheets use them: 00 is Short-Sleeved T-Shirt,
 * WH is White. Client-safe.
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
  { code: "SP", name: "Supplies", nameTh: "วัสดุสิ้นเปลือง", slug: "supplies" },
];

/** ST is the colour for items with no colour, such as shopping bags. */
export const MATRIX_COLORS: MatrixColor[] = [
  { code: "ST", name: "Standard", nameTh: "มาตรฐาน" },
  { code: "WH", name: "White", nameTh: "ขาว" },
  { code: "BK", name: "Black", nameTh: "ดำ" },
  { code: "BL", name: "Blue", nameTh: "น้ำเงิน" },
  { code: "RD", name: "Red", nameTh: "แดง" },
  { code: "KH", name: "Khaki", nameTh: "กากี" },
  { code: "SD", name: "Sand", nameTh: "ทราย" },
  { code: "OL", name: "Olive", nameTh: "เขียวมะกอก" },
  { code: "IN", name: "Indigo", nameTh: "คราม" },
];
