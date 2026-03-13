const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = '/tmp/renders';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let browser;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });
  }
  return browser;
}

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'owarin-renderer' }));

// Main render endpoint — compatible with HCTI-style POST
app.post('/v1/image', async (req, res) => {
  const { html, viewport_width, viewport_height } = req.body;

  if (!html) return res.status(400).json({ error: 'html is required' });

  const width  = parseInt(viewport_width)  || 1080;
  const height = parseInt(viewport_height) || 1350;

  try {
    const b    = await getBrowser();
    const page = await b.newPage();

    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Extra wait for fonts/images
    await new Promise(r => setTimeout(r, 1500));

    const filename = `${crypto.randomUUID()}.jpg`;
    const filepath = path.join(OUTPUT_DIR, filename);

    await page.screenshot({
      path: filepath,
      type: 'jpeg',
      quality: 92,
      clip: { x: 0, y: 0, width, height }
    });

    await page.close();

    // Return image directly as base64 + public URL
    const imgBuffer = fs.readFileSync(filepath);
    const base64    = imgBuffer.toString('base64');

    // Clean up after 5 min
    setTimeout(() => {
      try { fs.unlinkSync(filepath); } catch(e) {}
    }, 300000);

    res.json({
      url: `${req.protocol}://${req.get('host')}/image/${filename}`,
      base64: `data:image/jpeg;base64,${base64}`
    });

  } catch (err) {
    console.error('Render error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve rendered images
app.get('/image/:filename', (req, res) => {
  const filepath = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(filepath);
});

app.listen(PORT, () => {
  console.log(`owarin-renderer listening on port ${PORT}`);
});
