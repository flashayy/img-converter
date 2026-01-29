import express from "express";
import multer from "multer";
import sharp from "sharp";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root = o level vyššie než /server
const ROOT = path.resolve(__dirname, "..");
const UPLOADS = path.join(ROOT, "uploads");

fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.use(cors());
app.use(express.static(path.join(ROOT, "public")));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".bin");
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 } // 300MB
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/convert", upload.single("image"), async (req, res) => {
  const file = req.file;

  const cleanup = async () => {
    if (file?.path) {
      try { await fs.promises.unlink(file.path); } catch {}
    }
  };

  try {
    if (!file) return res.status(400).json({ error: "Missing image file" });

    const format = String(req.query.format || "avif").toLowerCase();
    const qRaw = Number(req.query.quality ?? 55);
    const quality = Number.isFinite(qRaw) ? Math.min(95, Math.max(1, qRaw)) : 55;

    const supportsAvif = !!(sharp.format?.avif?.output);
    const supportsWebp = !!(sharp.format?.webp?.output);

    let pipeline = sharp(file.path).rotate();

    let buffer, mime, ext;

    if (format === "avif") {
      if (!supportsAvif) return res.status(400).json({ error: "Sharp build nepodporuje AVIF output. Skús WebP." });
      buffer = await pipeline.avif({ quality }).toBuffer();
      mime = "image/avif";
      ext = "avif";
    } else if (format === "webp") {
      if (!supportsWebp) return res.status(400).json({ error: "Sharp build nepodporuje WebP output." });
      buffer = await pipeline.webp({ quality }).toBuffer();
      mime = "image/webp";
      ext = "webp";
    } else if (format === "jpg" || format === "jpeg") {
      buffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      mime = "image/jpeg";
      ext = "jpg";
    } else {
      return res.status(400).json({ error: "Unsupported format. Use avif/webp/jpg." });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(500).json({ error: "Conversion produced empty output." });
    }

    const baseName = (file.originalname || "image").replace(/\.[^.]+$/, "");
    const outName = `${baseName}.${ext}`;

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);

    await cleanup();
  } catch (err) {
    console.error(err);
    await cleanup();
    res.status(500).json({ error: "Conversion failed" });
  }
});

// Multer errors
app.use((err, _req, res, next) => {
  if (err?.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "Súbor je príliš veľký (prekročený upload limit servera).",
        code: err.code
      });
    }
    return res.status(400).json({ error: "Upload chyba.", code: err.code });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error." });
  }
  next();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server: http://localhost:${port}`));

app.get("/capabilities", (_req, res) => {
  res.json({
    avif: !!(sharp.format?.avif?.output),
    webp: !!(sharp.format?.webp?.output),
    jpg: true
  });
});
