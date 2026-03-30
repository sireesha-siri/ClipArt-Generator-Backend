require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '15mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000, max: 15,
  message: { error: 'Too many requests. Please wait a minute.' }
});
app.use('/api/', limiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Stability AI v2beta
// STABILITY_API_KEY=sk-xxxx in .env
// Sign up: https://platform.stability.ai (25 free credits)
// ─────────────────────────────────────────────────────────────────────────────
const STABILITY_KEY = process.env.STABILITY_API_KEY;

// control/structure: preserves exact layout/pose/composition of input photo
// control_strength 0.95 = very tightly follows input image structure
const STRUCTURE_URL = 'https://api.stability.ai/v2beta/stable-image/control/structure';

const STYLE_PROMPTS = {
  cartoon: {
    prompt: 'same people, same scene, cartoon illustration style, bold black outlines, vibrant cel-shading, Pixar Disney animation, expressive colorful clipart, same poses same composition',
    negative_prompt: 'different people, different scene, blurry, ugly, deformed, realistic photo, extra limbs, wrong skin tone',
    control_strength: '0.95',
  },
  anime: {
    prompt: 'same people, same scene, anime illustration, Studio Ghibli style, large expressive eyes, smooth cel shading, vibrant Japanese animation, same poses same composition',
    negative_prompt: 'different people, different scene, blurry, ugly, deformed, realistic photo, extra limbs, western cartoon',
    control_strength: '0.95',
  },
  pixel: {
    prompt: 'same people, same scene, pixel art style, 16-bit retro game sprite, chunky pixels, limited color palette, NES SNES aesthetic, same poses same composition',
    negative_prompt: 'different people, different scene, blurry, smooth, realistic, photo, extra limbs',
    control_strength: '0.92',
  },
  flat: {
    prompt: 'same people, same scene, flat design vector illustration, minimalist art, clean bold geometric shapes, solid colors, no gradients, no shadows, modern graphic clipart, same poses same composition',
    negative_prompt: 'different people, different scene, realistic, photo, 3d, texture, gradient, shadow, blurry',
    control_strength: '0.95',
  },
  sketch: {
    prompt: 'same people, same scene, pencil sketch illustration, hand drawn linework, fine crosshatching, graphite drawing, black and white fine art, same poses same composition',
    negative_prompt: 'different people, different scene, color, realistic photo, blurry, 3d, painting, noisy',
    control_strength: '0.97',
  },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function generateClipart(imageBuffer, style, customPrompt = '', retries = 2) {
  const config = STYLE_PROMPTS[style];
  if (!config) throw new Error(`Unknown style: ${style}`);

  const finalPrompt = customPrompt
    ? `${customPrompt}, ${config.prompt}`
    : config.prompt;

  console.log(`[generate] style=${style} strength=${config.control_strength}`);

  // Resize to 1024x1024
  const processed = await sharp(imageBuffer)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toBuffer();

  const form = new FormData();
  form.append('image', processed, { filename: 'input.png', contentType: 'image/png' });
  form.append('prompt', finalPrompt);
  form.append('negative_prompt', config.negative_prompt);
  form.append('control_strength', config.control_strength);
  form.append('output_format', 'png');

  try {
    const response = await axios.post(STRUCTURE_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${STABILITY_KEY}`,
        Accept: 'image/*',
      },
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    if (response.headers['finish-reason'] === 'CONTENT_FILTERED') {
      throw new Error('Image filtered by content policy. Try a different photo.');
    }

    const b64 = Buffer.from(response.data).toString('base64');
    return `data:image/png;base64,${b64}`;

  } catch (err) {
    const status = err.response?.status;
    let body = err.message;

    if (err.response?.data) {
      try {
        const raw = Buffer.from(err.response.data).toString('utf8');
        const parsed = JSON.parse(raw);
        body = parsed?.errors?.[0] || parsed?.message || raw;
      } catch (_) {}
    }

    if (status === 429 && retries > 0) {
      console.warn(`[generate] 429 rate limit, retrying in 10s... (${retries} left)`);
      await sleep(10000);
      return generateClipart(imageBuffer, style, customPrompt, retries - 1);
    }
    if (status === 402) throw new Error('Stability AI credits exhausted. Add credits at platform.stability.ai');
    if (status === 422) throw new Error(`Invalid request: ${body}`);

    console.error(`[generate] error ${status}:`, body);
    throw new Error(`Generation failed (${status}): ${body}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({
  status: 'ok', version: '9.0.0',
  provider: 'Stability AI v2beta control/structure',
  keySet: !!STABILITY_KEY,
  styles: Object.keys(STYLE_PROMPTS),
}));

app.post('/api/generate', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    if (!STABILITY_KEY) return res.status(500).json({ error: 'STABILITY_API_KEY not set in .env' });

    const { style = 'cartoon', customPrompt = '' } = req.body;
    if (!STYLE_PROMPTS[style]) {
      return res.status(400).json({ error: `Invalid style. Choose from: ${Object.keys(STYLE_PROMPTS).join(', ')}` });
    }

    const outputUrl = await generateClipart(req.file.buffer, style, customPrompt);
    res.json({ success: true, style, outputUrl });

  } catch (err) {
    console.error('[generate] error:', err.message);
    const status = err.message.includes('credits') ? 402
      : err.message.includes('content policy') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.post('/api/generate-all', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    if (!STABILITY_KEY) return res.status(500).json({ error: 'STABILITY_API_KEY not set in .env' });

    const { customPrompt = '' } = req.body;
    const styles = Object.keys(STYLE_PROMPTS);
    const outputs = [];

    for (const style of styles) {
      try {
        const outputUrl = await generateClipart(req.file.buffer, style, customPrompt);
        outputs.push({ style, outputUrl, success: true });
        console.log(`[generate-all] ✅ ${style} done`);
      } catch (err) {
        console.error(`[generate-all] ❌ ${style} failed:`, err.message);
        outputs.push({ style, error: err.message, success: false });
        if (err.message.includes('credits')) break;
      }
      await sleep(1000);
    }

    res.json({ success: true, outputs });

  } catch (err) {
    console.error('[generate-all] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 10MB.' });
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`✅ ClipArt API running on port ${PORT}`);
  console.log(`   Provider : Stability AI v2beta control/structure`);
  console.log(`   Strength : 0.92–0.97 (tightly follows your input photo)`);
  console.log(`   Key      : ${STABILITY_KEY ? '✅ set' : '❌ MISSING — add STABILITY_API_KEY to .env'}`);
});