import { convertLegacyToUnicode } from 'khmer-unicode-converter';
import fs from 'fs';
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(process.argv[3], JSON.stringify(a.map(s => convertLegacyToUnicode(s, 'limon'))));
