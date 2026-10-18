// Matching a folder of photos to styles and colours by file name. Run with: npx tsx tests/photo-files.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { matchColour, parsePhotoName, planPhotoFolder, type ColourOption, type ProductInfo } from "../lib/catalog/photo-files";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const colours: ColourOption[] = [
  { colorId: "c01", code: "01", name: "Off White", nameTh: "ขาวนวล" },
  { colorId: "c40", code: "40", name: "Black", nameTh: null },
  { colorId: "c90", code: "90", name: "PATTERN WHITE", nameTh: null },
];
const product = (name: string, extra: Partial<ProductInfo> = {}): ProductInfo => ({ id: `id-${name}`, name, hasPhoto: false, colours, colourPhotos: new Set(), ...extra });

test("names: style and colour code, with any picture extension and any case", () => {
  assert.deepEqual(parsePhotoName("LW252AN872_01.png"), { style: "LW252AN872", colour: "01" });
  assert.deepEqual(parsePhotoName("lw252an872_40.JPG"), { style: "LW252AN872", colour: "40" });
  assert.deepEqual(parsePhotoName("LW252AN872_Off White.webp"), { style: "LW252AN872", colour: "Off White" });
  assert.deepEqual(parsePhotoName("LW252AN872-90.jpeg"), { style: "LW252AN872", colour: "90" });
});

test("names: a file with no colour is the main photo of the style", () => {
  assert.deepEqual(parsePhotoName("LW252AN872.jpg"), { style: "LW252AN872", colour: null });
});

test("names: pictures only, and only with a style code first", () => {
  for (const bad of ["notes.txt", "LW252AN872_01.pdf", "photo1.png", "IMG_2041.jpg", "01_LW252AN872.png", "LW252AN87_01.png"]) assert.equal(parsePhotoName(bad), null, bad);
});

test("colour: by code first, then by English or Thai name, ignoring case and spacing", () => {
  assert.equal(matchColour("01", colours).kind, "match");
  assert.deepEqual(matchColour("off_white", colours), { kind: "match", colour: colours[0] });
  assert.deepEqual(matchColour("ขาวนวล", colours), { kind: "match", colour: colours[0] });
  assert.deepEqual(matchColour("pattern-white", colours), { kind: "match", colour: colours[2] });
});

test("colour: a code is exact (1 is not 01) and an unknown colour matches nothing", () => {
  assert.deepEqual(matchColour("1", colours), { kind: "none" });
  assert.deepEqual(matchColour("20", colours), { kind: "none" });
});

test("colour: a name that fits two colours is ambiguous, never picked", () => {
  const twin: ColourOption[] = [
    { colorId: "a", code: "10", name: "Blue", nameTh: null },
    { colorId: "b", code: "11", name: "blue", nameTh: null },
  ];
  assert.deepEqual(matchColour("Blue", twin), { kind: "ambiguous" });
});

test("plan: colour photos go to the right colour, a bare style code to the style, and each says what it replaces", () => {
  const { items } = planPhotoFolder(["LW252AN872_01.png", "LW252AN872_40.png", "LW252AN872.jpg"], [product("LW252AN872", { colourPhotos: new Set(["c40"]), hasPhoto: true })]);
  assert.deepEqual(items.map((i) => [i.file, i.target?.kind, i.hasPhoto]), [
    ["LW252AN872_01.png", "colour", false],
    ["LW252AN872_40.png", "colour", true],
    ["LW252AN872.jpg", "style", true],
  ]);
  assert.equal(items[0].target?.kind === "colour" && items[0].target.colorId, "c01");
});

test("plan: a colour the style is not sold in, a style that is not in the system, and a missing colour are reported with a reason", () => {
  const { items } = planPhotoFolder(["LW252AN872_20.png", "LW999XX999_01.png", "LW252AN872_.jpg", "random.png"], [product("LW252AN872")]);
  assert.ok(items.every((i) => !i.target), "none is used");
  assert.match(items[0].problem ?? "", /not a colour of LW252AN872.*01 Off White.*40 Black.*90 PATTERN WHITE/);
  assert.match(items[1].problem ?? "", /not in the system/);
  assert.match(items[2].problem ?? "", /colour is missing after the underscore.*LW252AN872_<colour code>/);
  assert.match(items[3].problem ?? "", /must start with a style code/);
});

test("plan: two files for the same colour (code and name) are both held back", () => {
  const { items } = planPhotoFolder(["LW252AN872_01.png", "LW252AN872_Off White.jpg"], [product("LW252AN872")]);
  assert.ok(items.every((i) => !i.target && /same place/.test(i.problem ?? "")));
});

test("plan: files that are not pictures are ignored, not errors", () => {
  const { items, ignored } = planPhotoFolder(["Thumbs.db", "notes.txt", "LW252AN872_01.png"], [product("LW252AN872")]);
  assert.deepEqual(ignored, ["Thumbs.db", "notes.txt"]);
  assert.equal(items.length, 1);
});

test("script: preview by default, keeps existing photos unless asked, and saves colour photos through the same rules as the admin page", () => {
  const script = readFileSync(path.join(__dirname, "..", "scripts", "import-photo-folder.ts"), "utf8");
  assert.ok(script.includes('args.includes("--apply")') && script.includes('args.includes("--replace")'));
  assert.ok(script.indexOf("if (!apply)") < script.indexOf("replaceProductImage(db, store"), "the preview returns before any upload");
  assert.ok(script.includes("productColorImage.upsert") && script.includes("PRODUCT_COLOR_IMAGE_SET") && script.includes("toWebp("));
  assert.ok(existsSync(path.join(__dirname, "..", "scripts", "import-photo-folder.ts")));
});

console.log(`\n${passed} photo-file tests passed`);
