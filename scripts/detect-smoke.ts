import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { detectMarks } from '@/lib/pipeline/extract/detect';
import { type VlmConfig, extractFromVlmEndpoint } from '@/lib/pipeline/extract/vlm';

/**
 * Live smoke test against a local VLM (default the Qwen2.5-VL server on :8010). Generates a
 * synthetic thesis-approval-like page (names + a red circular seal + a signature scribble), then:
 *   [1] extracts names, [2] detects seal/signature regions.
 * Proves the GPU path works end-to-end before real samples arrive. Run: npm run detect:smoke
 */

const cfg: VlmConfig = {
  baseUrl: process.env.VLM_BASE_URL ?? 'http://localhost:8010/v1',
  apiKey: process.env.VLM_API_KEY ?? 'local',
  model: process.env.VLM_MODEL ?? 'Qwen2.5-VL-7B-Instruct',
  timeoutMs: 120000,
};

function makeTestPage(out: string): void {
  const W = 1000;
  const H = 650;
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#111111';
  x.font = '30px sans-serif';
  x.fillText('학위논문 인준서 / Thesis Approval', 60, 70);
  x.font = '24px sans-serif';
  x.fillText('지도교수 Advisor:    이준호  Junho Lee', 60, 170);
  x.fillText('심사위원 Committee:  홍길동  Gildong Hong', 60, 240);
  x.fillText('학과장  Head:        이영희  Younghee Lee', 60, 310);
  // red circular seal near the advisor line
  x.strokeStyle = '#cc0000';
  x.lineWidth = 4;
  x.beginPath();
  x.arc(760, 160, 46, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = '#cc0000';
  x.font = 'bold 28px sans-serif';
  x.fillText('印', 745, 172);
  // handwritten-ish signature scribble near the committee line
  x.strokeStyle = '#000066';
  x.lineWidth = 2;
  x.beginPath();
  for (let i = 0; i < 70; i++) x.lineTo(700 + i * 3, 235 + Math.sin(i / 2) * 12);
  x.stroke();
  mkdirSync('/tmp', { recursive: true });
  writeFileSync(out, c.toBuffer('image/png'));
}

async function main(): Promise<void> {
  const img = '/tmp/seal-smoke.png';
  makeTestPage(img);
  // eslint-disable-next-line no-console
  console.log(`test page → ${img}\nendpoint: ${cfg.baseUrl} (${cfg.model})\n`);

  // eslint-disable-next-line no-console
  console.log('[1] name extraction (extractFromVlmEndpoint, image input)');
  const persons = await extractFromVlmEndpoint(cfg, {
    docType: 'degree_thesis',
    filename: 'smoke.png',
    pages: [{ pageNumber: 1, text: '', hasText: false, imagePath: img }],
    imagePaths: [img],
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(persons, null, 2));

  // eslint-disable-next-line no-console
  console.log('\n[2] mark detection (detectMarks)');
  const marks = await detectMarks(cfg, img, 1);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(marks, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
