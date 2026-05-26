#!/usr/bin/env node
// scripts/gen_placeholder_pdf.mjs
// One-shot generator for assets/guide/value-guide.pdf (placeholder, Stage 0).
// Zero-deps PDF 1.4 builder — hand-rolls a minimal 2-page document with
// Helvetica (one of the 14 standard PDF base fonts so no font embedding needed).
//
// English-only content because Chinese requires CID font embedding (~200 KB
// for a basic CJK subset) — pointless for a placeholder. Vivi + Damon's real
// 《價值觀挖掘指南》 will replace this same path (assets/guide/value-guide.pdf)
// when ready.
//
// Run:  node scripts/gen_placeholder_pdf.mjs
// Output: assets/guide/value-guide.pdf

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'assets', 'guide', 'value-guide.pdf');
mkdirSync(dirname(outPath), { recursive: true });

// ─── content streams (PDF text-positioning operators) ───────────────────
// BT/ET = begin/end text. /F1 24 Tf = font 1 at 24pt. Td = move text cursor.
// Tj = show string. PDF page coords: (0,0) bottom-left, A4 = 595 x 842 pt.

const page1Stream =
  'BT /F1 22 Tf 60 760 Td (Values Discovery Guide) Tj ET\n' +
  'BT /F1 14 Tf 60 720 Td (PLACEHOLDER - real version in production) Tj ET\n' +
  'BT /F1 12 Tf 60 670 Td (This is a placeholder PDF for the Stage 0 funnel) Tj ET\n' +
  'BT /F1 12 Tf 60 650 Td (lead-magnet flow. The real guide \\(by Vivi + Damon\\)) Tj ET\n' +
  'BT /F1 12 Tf 60 630 Td (will replace this file at the same path.) Tj ET\n' +
  'BT /F1 11 Tf 60 580 Td (Endpoint: POST /api/request-guide) Tj ET\n' +
  'BT /F1 11 Tf 60 560 Td (See spec: preview-1日漏斗最小測試版-spec.md) Tj ET\n';

const page2Stream =
  'BT /F1 22 Tf 60 760 Td (Coming soon) Tj ET\n' +
  'BT /F1 12 Tf 60 720 Td (The real guide will include:) Tj ET\n' +
  'BT /F1 12 Tf 60 680 Td (- The 5 questions that surface your real values) Tj ET\n' +
  'BT /F1 12 Tf 60 660 Td (- Why "what do you want?" beats "what should you do?") Tj ET\n' +
  'BT /F1 12 Tf 60 640 Td (- The containment test for true Top 1) Tj ET\n' +
  'BT /F1 12 Tf 60 620 Td (- How to spot resistance vs. real misalignment) Tj ET\n' +
  'BT /F1 11 Tf 60 100 Td (- The 看見自己 team) Tj ET\n';

// ─── assemble PDF objects (collect, then compute byte offsets) ──────────

function streamObj(id, body) {
  // \r\n is forbidden inside the stream by most strict readers; use \n.
  const length = Buffer.byteLength(body, 'latin1');
  return `${id} 0 obj\n<< /Length ${length} >>\nstream\n${body}endstream\nendobj\n`;
}

const objects = [
  // 1: catalog
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  // 2: pages tree
  '2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>\nendobj\n',
  // 3: page 1
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
    + '/Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>\nendobj\n',
  // 4: page 1 content stream
  streamObj(4, page1Stream),
  // 5: page 2
  '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
    + '/Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>\nendobj\n',
  // 6: page 2 content stream
  streamObj(6, page2Stream),
  // 7: font (Helvetica — one of the 14 standard base fonts)
  '7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica '
    + '/Encoding /WinAnsiEncoding >>\nendobj\n',
];

// ─── compute byte offsets for xref ──────────────────────────────────────

const header = '%PDF-1.4\n%âãÏÓ\n';   // binary marker comment
let cursor = Buffer.byteLength(header, 'latin1');
const offsets = [];
for (const obj of objects) {
  offsets.push(cursor);
  cursor += Buffer.byteLength(obj, 'latin1');
}

// xref table
const pad10 = (n) => String(n).padStart(10, '0');
const xrefStart = cursor;
const xref =
  `xref\n0 ${objects.length + 1}\n`
  + '0000000000 65535 f \n'
  + offsets.map(o => `${pad10(o)} 00000 n \n`).join('');

const trailer =
  `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  + `startxref\n${xrefStart}\n`
  + '%%EOF\n';

const pdf = header + objects.join('') + xref + trailer;
writeFileSync(outPath, Buffer.from(pdf, 'latin1'));
console.log(`wrote ${outPath} (${Buffer.byteLength(pdf, 'latin1')} bytes, 2 pages)`);
