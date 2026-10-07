/**
 * Court Pack human-readable report (report.pdf).
 *
 * Deterministic: given the same input it produces the same bytes (fixed dates,
 * no random document id), so the pack is reproducible and the report hash in the
 * manifest is stable.
 *
 * PDF/A-2b note: this generates a valid, deterministic PDF with document
 * metadata. STRICT PDF/A-2b conformance additionally requires an embedded ICC
 * OutputIntent and embedded fonts (shipped asset files) plus XMP pdfaid markers;
 * that is tracked as follow-up and does not affect the cryptographic integrity
 * chain (manifest/signature/merkle/timestamp), which secures the bytes either
 * way. Do not claim validator-level PDF/A-2b until the ICC/font assets land.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type CourtReportInput = {
  caseId: string;
  title: string;
  generatedAtIso: string; // deterministic, caller-provided
  summary: string;
  findings: string[];
  evidence: Array<{ path: string; sha256: string }>;
  signingKid: string;
  merkleRoot: string;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const FIXED_PDF_DATE = new Date("2000-01-01T00:00:00Z"); // determinism; real time lives in TSTInfo/execution.json

export async function buildCourtReportPdf(input: CourtReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setAuthor("PANDORA ForenX");
  doc.setSubject(`Court Pack report for case ${input.caseId}`);
  doc.setProducer("PANDORA ForenX Court Pack");
  doc.setCreator("PANDORA ForenX Court Pack");
  doc.setCreationDate(FIXED_PDF_DATE);
  doc.setModificationDate(FIXED_PDF_DATE);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const lineHeight = 14;

  const ensureSpace = (needed = lineHeight) => {
    if (y - needed < MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };
  const write = (text: string, f = font, size = 10, color = rgb(0.1, 0.1, 0.1)) => {
    ensureSpace();
    page.drawText(text, { x: MARGIN, y, size, font: f, color });
    y -= lineHeight;
  };
  const gap = (n = 1) => {
    y -= lineHeight * n;
  };

  write("PANDORA ForenX — Court Pack Report", bold, 16);
  gap();
  write(`Case: ${input.caseId}`, bold, 11);
  write(`Generated: ${input.generatedAtIso}`, font, 10, rgb(0.35, 0.35, 0.35));
  write(`Signing key id: ${input.signingKid}`, font, 10, rgb(0.35, 0.35, 0.35));
  write(`Merkle root: ${input.merkleRoot}`, mono, 8, rgb(0.35, 0.35, 0.35));
  gap();

  write("Summary", bold, 12);
  for (const line of wrap(input.summary, 95)) write(line);
  gap();

  write("Findings", bold, 12);
  if (input.findings.length === 0) write("(none recorded)", font, 10, rgb(0.5, 0.5, 0.5));
  input.findings.forEach((finding, index) => {
    for (const line of wrap(`${index + 1}. ${finding}`, 95)) write(line);
  });
  gap();

  write("Evidence integrity (SHA-256)", bold, 12);
  for (const item of input.evidence) {
    write(item.path, font, 9);
    write(`  ${item.sha256}`, mono, 8, rgb(0.3, 0.3, 0.3));
  }
  gap();
  write("Verify this pack offline with: node verify.mjs <packDir>", font, 9, rgb(0.3, 0.3, 0.3));

  return doc.save({ useObjectStreams: false });
}

function wrap(text: string, width: number): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
