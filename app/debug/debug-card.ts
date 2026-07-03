import { parseCardXLSX } from "@/lib/parsers";
import * as fs from "node:fs";
import path from "node:path";

// point this at your real card XLSX (download it locally if needed):
const file =
  "C:\\Users\\dajro\\Desktop\\פשיטת רגל\\דוח מאי - יוני\\6021_05_2026.xlsx";

const charges = parseCardXLSX(fs.readFileSync(file));
console.log("total charges:", charges.length);
console.log("distinct currencies:", [
  ...new Set(charges.map((c) => c.currency)),
]);
console.log(JSON.stringify(charges, null, 2));
