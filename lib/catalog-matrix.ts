/**
 * The standard Catalog IDs a fashion store starts from. Client-safe.
 *   Categories use the official two-letter Master Dictionary: TS = Short T-Shirts, BG = BAG.
 *   Colours use the numbered colour catalogue: 00 = White ... 23 = Sky Blue.
 */

export interface MatrixCategory {
  code: string;
  name: string;
  nameTh: string | null;
  slug: string;
}

export interface MatrixColor {
  code: string;
  name: string;
  nameTh: string;
}

/** The official category dictionary. Codes are two capital letters. The Thai names are not in this dictionary. */
const OFFICIAL_CATEGORIES: [string, string][] = [
  ["AN", "ANORAK"],
  ["BG", "BAG"],
  ["BT", "BELT"],
  ["CD", "CARDIGAN"],
  ["CP", "CAP"],
  ["CT", "COAT"],
  ["DJ", "DOWN JUMPER"],
  ["DK", "Denim Skirt"],
  ["DL", "Denim Long-pants"],
  ["DO", "Denim One-Piece"],
  ["DR", "Denim Shirts"],
  ["DS", "Denim Short-pants"],
  ["DT", "Denim Top"],
  ["DV", "DOWN VEST"],
  ["ET", "ETC"],
  ["GV", "Glove"],
  ["HD", "HOODY"],
  ["JP", "JUMPER"],
  ["KL", "Knit Long-pants"],
  ["KS", "Knit Short-pants"],
  ["KT", "KNIT"],
  ["LG", "Leggings"],
  ["MF", "Muffler"],
  ["MT", "MTM"],
  ["OP", "One-Piece"],
  ["SB", "Set-up Bottom"],
  ["SH", "SHOES"],
  ["SK", "Skirt"],
  ["SL", "SLEEVELESS"],
  ["SO", "SOX"],
  ["SR", "Shirt"],
  ["ST", "Set-up Top"],
  ["TL", "Long T-Shirts"],
  ["TS", "Short T-Shirts"],
  ["VT", "VEST"],
  ["WL", "Woven Long-pants"],
  ["WS", "Woven Short-pants"],
  ["WT", "WALLET"],
  ["ZT", "ZIP-UP"],
];

function slugFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const MATRIX_CATEGORIES: MatrixCategory[] = OFFICIAL_CATEGORIES.map(([code, name]) => ({
  code,
  name,
  nameTh: null,
  slug: slugFor(name),
}));

/** Every code the official dictionary allows. A category code outside this set is legacy. */
export const OFFICIAL_CATEGORY_CODES: ReadonlySet<string> = new Set(OFFICIAL_CATEGORIES.map(([code]) => code));

/** The numbered colour catalogue, as the colour sheet lists it. Names are unique in the database. */
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

/**
 * Standard for items with no colour, such as shopping bags. The seed creates it outside the numbered list, so existing
 * variants that use it keep working.
 */
export const STANDARD_COLOR_CODE = "ST";
