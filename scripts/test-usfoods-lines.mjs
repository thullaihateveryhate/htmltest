import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { parseUsFoodsLines } = require('./usfoodsParserLines.js');

const sampleLines = [
  '25 25 0 EA 6928998 BLACK OLIVES, SLICED 2/10 OZ $28.09',
  '12 12 0 CS 1234567 MOZZARELLA CHEESE SHREDDED 6/#10 $84.50',
];

const parsed = parseUsFoodsLines(sampleLines);
console.log('Parsed items:', parsed);
