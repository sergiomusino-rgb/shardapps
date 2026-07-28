import { jsPDF } from 'jspdf';

export interface PdfInvoiceRiga {
  descrizione: string;
  quantita: number;
  prezzoUnitario: number;
  aliquotaIva: number;
}

export interface PdfInvoiceInput {
  tipoDocumento: 'fattura' | 'ricevuta';
  numero: string;
  anno: number;
  dataEmissione: string;
  stato: string;
  cliente: { nome: string; piva?: string | null; indirizzo?: string | null };
  righe: PdfInvoiceRiga[];
  azienda: {
    ragioneSociale: string;
    piva?: string | null;
    indirizzo?: string | null;
    telefono?: string | null;
    logoUrl?: string | null;
  };
  /** Colore primario del tenant (hex, es. "#6366f1"), usato dal layout Moderno. */
  primaryColorHex: string;
}

export interface PdfLayoutMeta {
  key: 'classico' | 'moderno' | 'minimale';
  label: string;
  description: string;
}

export const PDF_LAYOUTS: PdfLayoutMeta[] = [
  { key: 'classico', label: 'Classico', description: 'Intestazione a sinistra, tabella con bordi — stile documento tradizionale.' },
  { key: 'moderno', label: 'Moderno', description: 'Banda colorata col brand del tenant, righe alternate senza bordi.' },
  { key: 'minimale', label: 'Minimale', description: 'Bianco e nero, tipografia pulita, massimo spazio bianco.' },
];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return [99, 102, 241];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function formatCurrency(n: number): string {
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('it-IT');
  } catch {
    return iso;
  }
}

function computeTotali(righe: PdfInvoiceRiga[]) {
  let imponibile = 0;
  let iva = 0;
  for (const r of righe) {
    const totRiga = r.quantita * r.prezzoUnitario;
    imponibile += totRiga;
    iva += totRiga * (r.aliquotaIva / 100);
  }
  return { imponibile, iva, totale: imponibile + iva };
}

function docTitle(input: PdfInvoiceInput): string {
  return input.tipoDocumento === 'ricevuta' ? 'RICEVUTA' : 'FATTURA';
}

function fileName(input: PdfInvoiceInput, layout: string): string {
  const base = `${input.tipoDocumento}-${input.numero}-${input.anno}`;
  return `${base}-${layout}.pdf`;
}

const PAGE_WIDTH = 210;
const MARGIN = 18;

// ─── Layout Classico ────────────────────────────────────────────────────────
// Intestazione azienda a sinistra, titolo a destra, tabella con bordi sottili.

export function generateClassicPdf(input: PdfInvoiceInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { imponibile, iva, totale } = computeTotali(input.righe);
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(input.azienda.ragioneSociale, MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  y += 6;
  if (input.azienda.piva) { doc.text(`P.IVA: ${input.azienda.piva}`, MARGIN, y); y += 4.5; }
  if (input.azienda.indirizzo) { doc.text(input.azienda.indirizzo, MARGIN, y); y += 4.5; }
  if (input.azienda.telefono) { doc.text(`Tel: ${input.azienda.telefono}`, MARGIN, y); y += 4.5; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  const [r, g, b] = hexToRgb(input.primaryColorHex);
  doc.setTextColor(r, g, b);
  doc.text(docTitle(input), PAGE_WIDTH - MARGIN, 22, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`Numero: ${input.numero}/${input.anno}`, PAGE_WIDTH - MARGIN, 29, { align: 'right' });
  doc.text(`Data: ${formatDate(input.dataEmissione)}`, PAGE_WIDTH - MARGIN, 34, { align: 'right' });
  doc.text(`Stato: ${input.stato.toUpperCase()}`, PAGE_WIDTH - MARGIN, 39, { align: 'right' });

  y = Math.max(y, 39) + 6;
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text('Cliente', MARGIN, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(input.cliente.nome, MARGIN, y);
  y += 4.5;
  if (input.cliente.piva) { doc.text(`P.IVA/CF: ${input.cliente.piva}`, MARGIN, y); y += 4.5; }
  if (input.cliente.indirizzo) { doc.text(input.cliente.indirizzo, MARGIN, y); y += 4.5; }

  y += 6;
  const colX = [MARGIN, 100, 130, 155, 178];
  const colW = [82, 30, 25, 23, PAGE_WIDTH - MARGIN - 178];
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(245, 245, 245);
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 7, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text('Descrizione', colX[0] + 2, y + 4.8);
  doc.text('Qtà', colX[1] + colW[1] - 2, y + 4.8, { align: 'right' });
  doc.text('Prezzo', colX[2] + colW[2] - 2, y + 4.8, { align: 'right' });
  doc.text('IVA%', colX[3] + colW[3] - 2, y + 4.8, { align: 'right' });
  doc.text('Totale', PAGE_WIDTH - MARGIN - 2, y + 4.8, { align: 'right' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  for (const riga of input.righe) {
    const totRiga = riga.quantita * riga.prezzoUnitario;
    const rowLines = doc.splitTextToSize(riga.descrizione, colW[0] - 4);
    const rowH = Math.max(6, rowLines.length * 4);
    doc.setDrawColor(225, 225, 225);
    doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, rowH);
    doc.text(rowLines, colX[0] + 2, y + 4.2);
    doc.text(String(riga.quantita), colX[1] + colW[1] - 2, y + 4.2, { align: 'right' });
    doc.text(formatCurrency(riga.prezzoUnitario), colX[2] + colW[2] - 2, y + 4.2, { align: 'right' });
    doc.text(`${riga.aliquotaIva}%`, colX[3] + colW[3] - 2, y + 4.2, { align: 'right' });
    doc.text(formatCurrency(totRiga), PAGE_WIDTH - MARGIN - 2, y + 4.2, { align: 'right' });
    y += rowH;
  }

  y += 8;
  const totalsX = PAGE_WIDTH - MARGIN - 70;
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text('Imponibile:', totalsX, y);
  doc.text(formatCurrency(imponibile), PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 5.5;
  doc.text('IVA:', totalsX, y);
  doc.text(formatCurrency(iva), PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 7;
  doc.setDrawColor(r, g, b);
  doc.line(totalsX, y - 4.5, PAGE_WIDTH - MARGIN, y - 4.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('TOTALE:', totalsX, y);
  doc.text(formatCurrency(totale), PAGE_WIDTH - MARGIN, y, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text('Documento generato con ZeusX', PAGE_WIDTH / 2, 287, { align: 'center' });

  return doc;
}

// ─── Layout Moderno ─────────────────────────────────────────────────────────
// Banda superiore a tutta larghezza nel colore del tenant, righe alternate.

export function generateModernPdf(input: PdfInvoiceInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { imponibile, iva, totale } = computeTotali(input.righe);
  const [r, g, b] = hexToRgb(input.primaryColorHex);

  doc.setFillColor(r, g, b);
  doc.rect(0, 0, PAGE_WIDTH, 38, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(input.azienda.ragioneSociale, MARGIN, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const subLine = [input.azienda.piva && `P.IVA ${input.azienda.piva}`, input.azienda.indirizzo]
    .filter(Boolean).join('  ·  ');
  if (subLine) doc.text(subLine, MARGIN, 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(docTitle(input), PAGE_WIDTH - MARGIN, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`N. ${input.numero}/${input.anno} · ${formatDate(input.dataEmissione)}`, PAGE_WIDTH - MARGIN, 23, { align: 'right' });

  // Badge stato
  doc.setFillColor(255, 255, 255);
  const statoText = input.stato.toUpperCase();
  const badgeW = doc.getTextWidth(statoText) + 8;
  doc.roundedRect(PAGE_WIDTH - MARGIN - badgeW, 27, badgeW, 6, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(r, g, b);
  doc.text(statoText, PAGE_WIDTH - MARGIN - badgeW / 2, 31, { align: 'center' });

  let y = 50;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('CLIENTE', MARGIN, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(30, 30, 30);
  doc.text(input.cliente.nome, MARGIN, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  if (input.cliente.piva) { doc.text(`P.IVA/CF: ${input.cliente.piva}`, MARGIN, y); y += 4.2; }
  if (input.cliente.indirizzo) { doc.text(input.cliente.indirizzo, MARGIN, y); y += 4.2; }

  y += 8;
  const colRight = [PAGE_WIDTH - MARGIN - 60, PAGE_WIDTH - MARGIN - 38, PAGE_WIDTH - MARGIN - 18, PAGE_WIDTH - MARGIN];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(r, g, b);
  doc.text('DESCRIZIONE', MARGIN, y);
  doc.text('QTÀ', colRight[0], y, { align: 'right' });
  doc.text('PREZZO', colRight[1], y, { align: 'right' });
  doc.text('IVA', colRight[2], y, { align: 'right' });
  doc.text('TOTALE', colRight[3], y, { align: 'right' });
  y += 3;
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 5;

  input.righe.forEach((riga, i) => {
    const totRiga = riga.quantita * riga.prezzoUnitario;
    const lines = doc.splitTextToSize(riga.descrizione, PAGE_WIDTH - MARGIN * 2 - 65);
    const rowH = Math.max(7, lines.length * 4);
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 250);
      doc.rect(MARGIN - 2, y - 4.5, PAGE_WIDTH - MARGIN * 2 + 4, rowH + 2, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.text(lines, MARGIN, y);
    doc.text(String(riga.quantita), colRight[0], y, { align: 'right' });
    doc.text(formatCurrency(riga.prezzoUnitario), colRight[1], y, { align: 'right' });
    doc.text(`${riga.aliquotaIva}%`, colRight[2], y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(totRiga), colRight[3], y, { align: 'right' });
    y += rowH;
  });

  y += 8;
  const totalsX = PAGE_WIDTH - MARGIN - 70;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text('Imponibile', totalsX, y);
  doc.text(formatCurrency(imponibile), PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 5.5;
  doc.text('IVA', totalsX, y);
  doc.text(formatCurrency(iva), PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 9;
  doc.setFillColor(r, g, b);
  doc.roundedRect(totalsX - 4, y - 6.5, PAGE_WIDTH - MARGIN - totalsX + 4, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTALE', totalsX, y);
  doc.text(formatCurrency(totale), PAGE_WIDTH - MARGIN, y, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(170, 170, 170);
  doc.text('Documento generato con ZeusX', PAGE_WIDTH / 2, 287, { align: 'center' });

  return doc;
}

// ─── Layout Minimale ────────────────────────────────────────────────────────
// Bianco e nero, tipografia pulita, molto spazio bianco.

export function generateMinimalPdf(input: PdfInvoiceInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { imponibile, iva, totale } = computeTotali(input.righe);
  let y = 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text(docTitle(input), MARGIN, y);
  doc.text(`N. ${input.numero}/${input.anno}`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 15, 15);
  doc.text(input.azienda.ragioneSociale, MARGIN, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  const infoLeft = [input.azienda.piva && `P.IVA ${input.azienda.piva}`, input.azienda.indirizzo, input.azienda.telefono].filter(Boolean) as string[];
  const infoRight = [`Data ${formatDate(input.dataEmissione)}`, `Stato ${input.stato.toUpperCase()}`];
  const infoStartY = y;
  infoLeft.forEach((line, i) => doc.text(line, MARGIN, infoStartY + i * 4.2));
  infoRight.forEach((line, i) => doc.text(line, PAGE_WIDTH - MARGIN, infoStartY + i * 4.2, { align: 'right' }));
  y = infoStartY + Math.max(infoLeft.length, infoRight.length) * 4.2 + 10;

  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('CLIENTE', MARGIN, y);
  y += 5;
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text(input.cliente.nome, MARGIN, y);
  y += 4.5;
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  if (input.cliente.piva) { doc.text(`P.IVA/CF ${input.cliente.piva}`, MARGIN, y); y += 4; }
  if (input.cliente.indirizzo) { doc.text(input.cliente.indirizzo, MARGIN, y); y += 4; }

  y += 10;
  const colRight = [PAGE_WIDTH - MARGIN - 60, PAGE_WIDTH - MARGIN - 38, PAGE_WIDTH - MARGIN - 18, PAGE_WIDTH - MARGIN];
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text('DESCRIZIONE', MARGIN, y);
  doc.text('QTÀ', colRight[0], y, { align: 'right' });
  doc.text('PREZZO', colRight[1], y, { align: 'right' });
  doc.text('IVA', colRight[2], y, { align: 'right' });
  doc.text('TOTALE', colRight[3], y, { align: 'right' });
  y += 3;
  doc.setDrawColor(20, 20, 20);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 6;

  for (const riga of input.righe) {
    const totRiga = riga.quantita * riga.prezzoUnitario;
    const lines = doc.splitTextToSize(riga.descrizione, PAGE_WIDTH - MARGIN * 2 - 65);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 30);
    doc.text(lines, MARGIN, y);
    doc.text(String(riga.quantita), colRight[0], y, { align: 'right' });
    doc.text(formatCurrency(riga.prezzoUnitario), colRight[1], y, { align: 'right' });
    doc.text(`${riga.aliquotaIva}%`, colRight[2], y, { align: 'right' });
    doc.text(formatCurrency(totRiga), colRight[3], y, { align: 'right' });
    y += Math.max(6, lines.length * 4) + 3;
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y - 2, PAGE_WIDTH - MARGIN, y - 2);
  }

  y += 6;
  const totalsX = PAGE_WIDTH - MARGIN - 70;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('Imponibile', totalsX, y);
  doc.text(formatCurrency(imponibile), PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 5.5;
  doc.text('IVA', totalsX, y);
  doc.text(formatCurrency(iva), PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 8;
  doc.setDrawColor(20, 20, 20);
  doc.line(totalsX, y - 5, PAGE_WIDTH - MARGIN, y - 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 15, 15);
  doc.text('TOTALE', totalsX, y);
  doc.text(formatCurrency(totale), PAGE_WIDTH - MARGIN, y, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(180, 180, 180);
  doc.text('Documento generato con ZeusX', PAGE_WIDTH / 2, 287, { align: 'center' });

  return doc;
}

export function generatePdfByLayout(layout: PdfLayoutMeta['key'], input: PdfInvoiceInput): jsPDF {
  if (layout === 'moderno') return generateModernPdf(input);
  if (layout === 'minimale') return generateMinimalPdf(input);
  return generateClassicPdf(input);
}

/** Scarica il PDF generato con un nome file coerente. */
export function downloadInvoicePdf(layout: PdfLayoutMeta['key'], input: PdfInvoiceInput): void {
  const doc = generatePdfByLayout(layout, input);
  doc.save(fileName(input, layout));
}
