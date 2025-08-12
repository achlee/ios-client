import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attempt to load API key from a mounted secret file if env var is not set
const defaultSecretFilePath = "/var/secrets/OPENAI_API_KEY";
if (!process.env.OPENAI_API_KEY && fs.existsSync(process.env.OPENAI_API_KEY_FILE || defaultSecretFilePath)) {
  try {
    const filePath = process.env.OPENAI_API_KEY_FILE || defaultSecretFilePath;
    const key = fs.readFileSync(filePath, "utf8").trim();
    if (key) process.env.OPENAI_API_KEY = key;
  } catch (_) {
    // ignore
  }
}

if (!process.env.OPENAI_API_KEY) {
  // eslint-disable-next-line no-console
  console.error("Missing OPENAI_API_KEY (env var or mounted secret file). Exiting.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const PROMPT = `You are scanning a manga page to detect dialog/text areas typically in bubbles.
Task:
- Identify panels and within each, dialog bubbles containing text.
- Order scanning top-to-bottom, right-to-left (manga reading order).
- Translate each bubble’s text into pinyin and English.

Output strictly as JSON only with this structure:
{
  "panels": [
    {
      "panelNumber": 1,
      "bubbles": [
        {
          "bubbleNumber": 1,
          "translations": { "pinyin": "<string>", "english": "<string>" },
          "boxes": [
            { "x": 0, "y": 0, "width": 0, "height": 0 }
          ]
        }
      ]
    }
  ],
  "meta": {
    "ordering": "top-to-bottom, right-to-left",
    "coordinateSystem": "pixel",
    "notes": "<optional>"
  }
}
Rules:
- Use integer pixel coordinates relative to the original image for boxes.
- If a bubble spans multiple boxes, include all of them in order (top-to-bottom, right-to-left).
- If a panel has no text, include it with an empty bubbles array.
- If uncertain, provide best effort and note uncertainty in meta.notes.
Return JSON only; no prose.`;

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded. Use form field 'image'." });
    }

    const mime = req.file.mimetype || "image/png";
    if (!mime.startsWith("image/")) {
      return res.status(400).json({ error: "Uploaded file must be an image." });
    }

    const base64 = req.file.buffer.toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a precise OCR and layout analyst for manga." },
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "Upstream returned empty content" });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return res.status(502).json({ error: "Upstream returned non-JSON content", upstream: content });
    }

    res.json(parsed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});