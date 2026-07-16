// 보고서 → PPTX / Excel 실 파일 생성 (BUILD 명세 §5 매핑)
import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';

const GREEN = '006241', ACCENT = '00754a', DARK = '1e3932', CREAM = 'f2f0eb', CERAMIC = 'edebe9', STRIPE = 'f9f9f9';

// 슬라이드: (1) 표지 (2) 요약 (3) 지표 (4) 데이터 표 (5~) 섹션
export async function buildPptx(report, reqLabel) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  // (1) 표지
  let s = pptx.addSlide();
  s.background = { color: DARK };
  s.addText('REPORT', { x: 0.8, y: 1.6, w: 11.7, fontSize: 14, color: 'CBA258', bold: true, charSpacing: 4 });
  s.addText(report.title || '보고서', { x: 0.8, y: 2.1, w: 11.7, fontSize: 34, color: 'FFFFFF', bold: true });
  s.addText(report.subtitle || reqLabel, { x: 0.8, y: 3.3, w: 11.7, fontSize: 16, color: 'D4E9E2' });
  s.addText(`${report.author || '팀장'} · ${report.date || ''}`, { x: 0.8, y: 6.3, w: 11.7, fontSize: 12, color: 'D4E9E2' });

  // (2) 요약
  s = pptx.addSlide();
  s.addText('SUMMARY', { x: 0.8, y: 0.5, fontSize: 13, color: ACCENT, bold: true, charSpacing: 3 });
  s.addShape('rect', { x: 0.8, y: 1.1, w: 11.7, h: 4.5, fill: { color: CREAM }, line: { color: CERAMIC } });
  s.addText(report.summary || '', { x: 1.1, y: 1.4, w: 11.1, h: 3.9, fontSize: 15, color: '363636', valign: 'top', lineSpacingMultiple: 1.4 });

  // (3) 지표
  const metrics = report.metrics || [];
  if (metrics.length) {
    s = pptx.addSlide();
    s.addText('METRICS', { x: 0.8, y: 0.5, fontSize: 13, color: ACCENT, bold: true, charSpacing: 3 });
    const w = 2.8, gap = 0.3;
    metrics.slice(0, 4).forEach((m, i) => {
      const x = 0.8 + i * (w + gap);
      s.addShape('roundRect', { x, y: 1.4, w, h: 2.2, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: CERAMIC } });
      s.addText(m.label || '', { x: x + 0.15, y: 1.6, w: w - 0.3, fontSize: 12, color: '6B6B6B' });
      s.addText(String(m.value ?? ''), { x: x + 0.15, y: 2.1, w: w - 0.3, fontSize: 30, bold: true, color: (m.color || '#006241').replace('#', '') });
    });
  }

  // (4) 데이터 표
  if (report.table?.cols?.length) {
    s = pptx.addSlide();
    s.addText('DATA', { x: 0.8, y: 0.5, fontSize: 13, color: ACCENT, bold: true, charSpacing: 3 });
    const rows = [
      report.table.cols.map(c => ({ text: String(c), options: { bold: true, color: GREEN, fill: { color: CERAMIC } } })),
      ...(report.table.rows || []).map((r, i) => r.map(c => ({ text: String(c), options: { fill: { color: i % 2 ? STRIPE : 'FFFFFF' } } }))),
    ];
    s.addTable(rows, { x: 0.8, y: 1.2, w: 11.7, fontSize: 12, border: { pt: 0.5, color: 'E7E7E7' }, autoPage: true });
  }

  // (5~) 섹션
  for (const sec of report.sections || []) {
    s = pptx.addSlide();
    s.addText(sec.h || '', { x: 0.8, y: 0.6, w: 11.7, fontSize: 20, color: GREEN, bold: true });
    s.addText(sec.b || '', { x: 0.8, y: 1.5, w: 11.7, h: 5, fontSize: 14, color: '363636', valign: 'top', lineSpacingMultiple: 1.45 });
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

// 시트: Summary / Metrics / Data / Sections
export async function buildXlsx(report, reqLabel) {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.author || '팀장';

  const headerStyle = {
    font: { bold: true, color: { argb: 'FF006241' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEBE9' } },
  };

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 16 }, { width: 90 }];
  sum.addRows([
    ['제목', report.title || ''],
    ['부제', report.subtitle || reqLabel || ''],
    ['작성', report.author || '팀장'],
    ['일시', report.date || ''],
    ['요약', report.summary || ''],
  ]);
  sum.getColumn(1).font = { bold: true, color: { argb: 'FF006241' } };
  sum.getCell('B5').alignment = { wrapText: true, vertical: 'top' };

  const met = wb.addWorksheet('Metrics');
  met.columns = [{ header: 'Label', width: 30 }, { header: 'Value', width: 20 }];
  met.getRow(1).eachCell(c => Object.assign(c, headerStyle));
  for (const m of report.metrics || []) met.addRow([m.label, m.value]);

  const data = wb.addWorksheet('Data');
  if (report.table?.cols?.length) {
    data.columns = report.table.cols.map(c => ({ header: String(c), width: Math.max(18, String(c).length + 6) }));
    data.getRow(1).eachCell(c => Object.assign(c, headerStyle));
    for (const [i, r] of (report.table.rows || []).entries()) {
      const row = data.addRow(r);
      if (i % 2) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } }; });
    }
  }

  const secs = wb.addWorksheet('Sections');
  secs.columns = [{ header: '소제목', width: 28 }, { header: '내용', width: 100 }];
  secs.getRow(1).eachCell(c => Object.assign(c, headerStyle));
  for (const sec of report.sections || []) {
    const row = secs.addRow([sec.h, sec.b]);
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
