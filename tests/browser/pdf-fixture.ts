/** Valid two-page synthetic PDF, including an xref table for real renderer tests. */
export function pdfFixture():Buffer{
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'];
 for(const [index,label] of ['Roteiva QA page one','Roteiva QA page two'].entries()){
  const stream=`BT /F1 24 Tf 40 180 Td (${label}) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents ${index===0?4:6} 0 R >>`);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 }
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 let result='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(result);
 result+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
 result+=offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 return Buffer.from(result+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
