import fs from 'node:fs';

// iOS .ips çökme raporundan istisna türünü ve çöken iş parçacığının ilk karelerini
// GitHub iş akışı uyarısı olarak yazar. Kullanım: node scripts/ios-crash-summary.mjs <rapor.ips>
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('::error title=iOS çökme raporu::Rapor dosyası bulunamadı.');
  process.exit(0);
}
const raw = fs.readFileSync(file, 'utf8');
const bodyStart = raw.indexOf('\n{');
let report;
try {
  report = JSON.parse(bodyStart >= 0 ? raw.slice(bodyStart + 1) : raw);
} catch {
  console.log(`::error title=iOS çökme raporu::Rapor okunamadı: ${raw.slice(0, 300).replace(/\s+/g, ' ')}`);
  process.exit(0);
}
const exception = report.exception || {};
console.log(`::error title=iOS çökme::${exception.type || '?'} ${exception.signal || ''} ${exception.subtype || ''}`.trim());
const images = report.usedImages || [];
const thread = (report.threads || []).find((item) => item.triggered) || (report.threads || [])[0];
for (const frame of (thread?.frames || []).slice(0, 12)) {
  const image = images[frame.imageIndex]?.name || `image#${frame.imageIndex}`;
  const symbol = frame.symbol ? `${frame.symbol}+${frame.symbolLocation ?? 0}` : `offset ${frame.imageOffset}`;
  console.log(`::error title=Çöken iş parçacığı::${image} ${symbol}`);
}
