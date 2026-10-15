import { apiError } from "@/lib/api";
import { parseCsv, parseXlsx } from "@/lib/tabular";

/** Vercel rejects request bodies over 4.5 MB, so stay a little under it. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Reads an uploaded .xlsx or .csv into rows of text. Returns the error response when the file is unusable. */
export async function readUploadedTable(file: File): Promise<{ table: string[][] } | { response: Response }> {
  const name = file.name.toLowerCase();
  if (file.size === 0) return { response: apiError(400, "FILE_EMPTY", "The file is empty.") };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { response: apiError(413, "FILE_TOO_LARGE", "The file is larger than 4 MB. Split it into smaller imports.") };
  }
  if (name.endsWith(".xls")) {
    return { response: apiError(415, "UNSUPPORTED_TYPE", "Old .xls files are not supported. Save the sheet as .xlsx or .csv.") };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  try {
    if (name.endsWith(".xlsx") || isZip(bytes)) {
      if (!isZip(bytes)) return { response: apiError(415, "UNSUPPORTED_TYPE", "That does not look like a real .xlsx file.") };
      return { table: await parseXlsx(buffer) };
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return { table: parseCsv(new TextDecoder("utf-8").decode(bytes)) };
    }
  } catch {
    return { response: apiError(422, "UNREADABLE_FILE", "The file could not be read. Check that it is a valid .xlsx or .csv file.") };
  }
  return { response: apiError(415, "UNSUPPORTED_TYPE", "Upload an .xlsx or .csv file.") };
}

