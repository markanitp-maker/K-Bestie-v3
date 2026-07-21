const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SENTENCES = [
  { id: 'greeting', text: '안녕, 나는 케이야. 넌 누구니?' },
  { id: 'school_life', text: '학교에서 오늘 무슨 일 있었어?' },
  { id: 'peer_relations', text: '오늘 친구랑 뭐 하고 놀았어?' },
  { id: 'emotion', text: '오늘 기분은 어때? 색깔로 말하면 무슨 색?' },
  { id: 'interests', text: '요즘 제일 좋아하는 게 뭐야?' },
  { id: 'study_concerns', text: '요즘 학원이나 공부는 어때?' },
  { id: 'digital_interests', text: '요즘 유튜브나 게임 뭐 보고 있어?' },
  { id: 'future_dreams', text: '커서 뭐가 되고 싶어? 요즘 생각은 어때?' },
  { id: 'recurring_stories', text: '오늘 하루 중 가장 기억에 남는 순간은?' },
  { id: 'daily_general', text: '지금 제일 하고 싶은 게 뭐야?' },
  { id: 'closing', text: '오늘 미션 끝났어. 이야기해 줘서 고마워. 잘 자!' }
];

function createWavHeader(dataLength) {
  const numChannels = 1;
  const sampleRate = 24000;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Logging in...');
  await page.goto('https://k-bestie-v3-dev.vercel.app/login');
  await page.fill('input[placeholder*="아이디"]', 'qaclaude160202');
  await page.fill('input[placeholder*="비밀번호"]', 'kbverify2026!');
  await page.locator('button:has-text("로그인")').last().click();
  
  try {
    await page.waitForURL(/\/child\//, { timeout: 15000 });
  } catch (e) {
    console.log('waitForURL timeout, falling back to waitForTimeout...');
    await page.waitForTimeout(5000);
  }

  console.log('Fetching childId...');
  const childIdResult = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/child/me");
      if (!res.ok) {
        return { id: null, error: `Status: ${res.status} | Body: ${await res.text()}` };
      }
      const data = await res.json();
      return { id: data.id, error: null };
    } catch (e) {
      return { id: null, error: e.message };
    }
  });

  const childId = childIdResult.id;

  if (!childId) {
    console.error('Failed to fetch childId (login may have failed).');
    console.error('API Error Details:', childIdResult.error);
    await browser.close();
    process.exit(1);
  }
  console.log(`Child ID: ${childId}`);

  const outputDir = path.join(__dirname, '..', 'public', 'demo-audio');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = [];

  for (let i = 0; i < SENTENCES.length; i++) {
    const sentence = SENTENCES[i];
    let success = false;
    let attempts = 0;
    let finalResult = null;
    const prefix = (i + 1).toString().padStart(2, '0');
    const filename = `${prefix}-${sentence.id}.wav`;
    const outputPath = path.join(outputDir, filename);

    while (!success && attempts < 5) {
      attempts++;
      console.log(`[${i+1}/${SENTENCES.length}] Processing "${sentence.id}" (Attempt ${attempts}/5)...`);
      
      const res = await page.evaluate(async ({ childId, targetText }) => {
        return new Promise(async (resolve) => {
          try {
            const K_TEXT_LEAK_PATTERNS = [
              /\[[^\]]*\]/,
              /라고.{0,6}말하면.{0,4}(돼|될까요|되나요|될지)/,
              /그대로\s*말하면/,
              /소리내어\s*그대로/,
              /시스템\s*지시/,
              /다음\s*문장을?\s*(그대로|자연스럽게)/,
              /현재\s*물어봐야\s*할/,
            ];

            const tokenRes = await fetch('/api/voice/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ childId })
            });
            if (!tokenRes.ok) return resolve({ success: false, reason: 'Failed to fetch /api/voice/token' });
            
            const tokenData = await tokenRes.json();
            if (!tokenData.wsUrl) return resolve({ success: false, reason: 'No wsUrl returned' });

            const ws = new WebSocket(tokenData.wsUrl);
            let pcmChunks = [];
            let fullText = '';
            
            ws.onmessage = async (event) => {
              try {
                let textData = event.data;
                if (event.data instanceof Blob) {
                  textData = await event.data.text();
                }

                const msg = JSON.parse(textData);

                if (msg.type === "ready") {
                  ws.send(JSON.stringify({
                    type: "text",
                    text: `다음 문장을 자연스럽게 소리내어 그대로 말해줘: "${targetText}"`
                  }));
                  return;
                }

                if (msg.type === "ping") {
                  ws.send(JSON.stringify({ type: "pong" }));
                  return;
                }

                if (msg.type === "message") {
                  if (msg.payload?.data) {
                    pcmChunks.push(msg.payload.data);
                  }
                  
                  if (msg.payload?.serverContent?.outputTranscription?.text) {
                    fullText += msg.payload.serverContent.outputTranscription.text;
                  }

                  if (msg.payload?.serverContent?.turnComplete === true) {
                    ws.close();
                    
                    const cleanText = fullText.trim().replace(/^['"]|['"]$/g, '').trim();
                    const hasLeak = K_TEXT_LEAK_PATTERNS.some(re => re.test(cleanText));
                    
                    const normalize = t => t.replace(/[\s.,!?~"']/g, '');
                    const isMatch = normalize(cleanText) === normalize(targetText);
                    
                    if (hasLeak) {
                      resolve({ success: false, text: cleanText, reason: 'Leak detected' });
                    } else if (!isMatch) {
                      resolve({ success: false, text: cleanText, reason: 'Text mismatch' });
                    } else {
                      resolve({ success: true, text: cleanText, pcmChunks });
                    }
                  }
                }
              } catch (e) {
                // Ignore parsing errors for other plain text messages
              }
            };

            ws.onerror = () => resolve({ success: false, reason: 'WebSocket Error' });
            ws.onclose = () => resolve({ success: false, reason: 'WebSocket Closed without turnComplete' });

          } catch (err) {
            resolve({ success: false, reason: err.message });
          }
        });
      }, { childId, targetText: sentence.text });

      if (res.success) {
        success = true;
        finalResult = res;
        
        const buffers = res.pcmChunks.map(b64 => Buffer.from(b64, 'base64'));
        const pcmData = Buffer.concat(buffers);
        const header = createWavHeader(pcmData.length);
        const finalWav = Buffer.concat([header, pcmData]);
        
        fs.writeFileSync(outputPath, finalWav);
        results.push({
          id: sentence.id,
          success: true,
          text: res.text,
          attempts,
          path: outputPath,
          bytes: finalWav.length
        });
        console.log(`  -> Success! Text matched. Saved ${finalWav.length} bytes to ${filename}`);
      } else {
        console.log(`  -> Failed: ${res.reason} (Text: "${res.text || ''}")`);
        await page.waitForTimeout(500); // Brief pause before retry
      }
    }

    if (!success) {
      results.push({
        id: sentence.id,
        success: false,
        text: finalResult ? finalResult.text : 'N/A',
        attempts,
        path: null,
        bytes: 0
      });
      console.log(`  -> Skipped after 5 failed attempts.`);
    }
    
    // Short wait between sentences to not mess up sessions
    await page.waitForTimeout(500);
  }

  await browser.close();

  console.log('\n--- Final Summary ---');
  console.table(results.map(r => ({
    'ID': r.id,
    'Success': r.success ? '✅' : '❌',
    'Attempts': r.attempts,
    'Text Recognized': r.text,
    'Bytes': r.bytes || '-'
  })));
}

run().catch(console.error);
