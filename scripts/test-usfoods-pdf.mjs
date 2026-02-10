import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseUsFoodsInvoicePdf } from './usfoodsPdfParserNode.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.resolve('C:/Users/Harry/Downloads/usfoods.pdf');
const buf = fs.readFileSync(pdfPath);

(async () => {
  const items = await parseUsFoodsInvoicePdf(buf);
  console.log('Extracted items:', items);
})();
