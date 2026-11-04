// The student's Form I-20 as a PDF: redacted by code in the relay, then read by Spark (input_file).
// Redaction is real, not cosmetic: the PDF is rebuilt from its text layer with the identifying items removed
// (black boxes drawn where they were), so the hosted model never receives the name, SEVIS ID, date of birth or email.
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
const require = createRequire(import.meta.url);
const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');

const SEVIS = /\bN[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{4}\b|\bN\d{10}\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const ID_LABELS = /^(surname|primary name|surname\/primary name|given name|family name|first name|date of birth|student email address|email|passport( number)?|sevis id|student id|emplid)\b/i;
const BASE = 'https://api.meta.ai/v1';

/** Extract positioned text items from every page. */
async function textItems(buf) {
  const pdfjs = await import(pdfjsPath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[3]) || 10, w: it.width, h: it.height || Math.abs(it.transform[3]) }));
    pages.push({ width: vp.width, height: vp.height, items });
  }
  return pages;
}

/** Decide which items are identifying. @param {import('./redact.mjs').Redactor} redactor */
function markIdentifying(items, redactor) {
  const hits = new Set();
  const sameCellValue = (label, i) => { for (let j = i + 1; j < Math.min(items.length, i + 6); j++) { const v = items[j]; if (Math.abs(v.x - label.x) < 4 && v.y < label.y && label.y - v.y < 22) return j; } return -1; };
  items.forEach((it, i) => {
    if (SEVIS.test(it.str) || EMAIL.test(it.str)) hits.add(i);
    if (redactor && redactor.nameRes.some(({ re }) => { re.lastIndex = 0; return re.test(it.str); })) hits.add(i);
    if (ID_LABELS.test(it.str.trim())) { const j = sameCellValue(it, i); if (j >= 0) hits.add(j); if (/sevis id/i.test(it.str) && SEVIS.test(it.str)) hits.add(i); }
  });
  // a SEVIS id inside a longer label line ("SEVIS ID: N00…"): keep the label, drop the number by replacing the item text
  return hits;
}

/** Rebuild the PDF from its text layer, with identifying items replaced by black boxes. Returns { pdf: Buffer, boxes: number, pages: number } */
export async function redactPdf(buf, redactor) {
  const pages = await textItems(buf);
  const out = await PDFDocument.create(); const font = await out.embedFont(StandardFonts.Helvetica); const bold = await out.embedFont(StandardFonts.HelveticaBold);
  let boxes = 0;
  for (const pg of pages) {
    const page = out.addPage([pg.width, pg.height]);
    const hits = markIdentifying(pg.items, redactor);
    pg.items.forEach((it, i) => {
      if (hits.has(i)) { page.drawRectangle({ x: it.x - 1, y: it.y - 2, width: Math.max(it.w, 24) + 2, height: it.size + 3, color: rgb(0, 0, 0) }); boxes++; return; }
      let str = it.str; if (SEVIS.test(str)) { str = str.replace(SEVIS, '[SEVIS_ID]'); boxes++; }
      const size = Math.max(6, Math.min(it.size, 18));
      try { page.drawText(str, { x: it.x, y: it.y, size, font: /^[A-Z0-9 ,.'$·-]+$/.test(str) && str.length > 2 ? bold : font, color: rgb(0.07, 0.07, 0.07) }); } catch { page.drawText(str.replace(/[^\x20-\x7e]/g, '?'), { x: it.x, y: it.y, size, font }); }
    });
    page.drawText('REDACTED COPY — rebuilt from the text layer by Henry Listens; identifiers removed before any model saw it', { x: 36, y: 14, size: 7, font, color: rgb(0.5, 0.1, 0.1) });
  }
  return { pdf: Buffer.from(await out.save()), boxes, pages: pages.length };
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['document_type', 'program_start', 'program_end', 'education_level', 'major', 'issue_reason', 'identifiers_visible'],
  properties: { document_type: { type: 'string' }, program_start: { type: 'string', description: 'YYYY-MM-DD or ""' }, program_end: { type: 'string', description: 'YYYY-MM-DD or ""' }, education_level: { type: 'string' }, major: { type: 'string' }, issue_reason: { type: 'string' }, identifiers_visible: { type: 'boolean', description: 'true if a person name, SEVIS ID, date of birth or email is readable in the document' } } };

/** Spark reads the redacted I-20 (input_file). Returns the fields. */
export async function readI20(pdfBuf, key, model = process.env.AGENT_MODEL || 'muse-spark-1.3') {
  const body = { model, instructions: 'You read U.S. immigration school forms. Extract only what is printed. Dates as YYYY-MM-DD. If a field is missing, use "".', reasoning: { effort: 'low' },
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read this Form I-20 and return the program fields.' }, { type: 'input_file', filename: 'i-20-redacted.pdf', file_data: 'data:application/pdf;base64,' + pdfBuf.toString('base64') }] }],
    text: { format: { type: 'json_schema', name: 'i20', strict: true, schema: SCHEMA } } };
  const r = await fetch(BASE + '/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  const text = (j.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  return { fields: JSON.parse(text), usage: j.usage };
}
