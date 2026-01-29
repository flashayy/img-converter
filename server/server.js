/* =====================================================
   IMPORTY
   ===================================================== */

// web server framework
import express from "express";

// middleware na upload súborov (multipart/form-data)
import multer from "multer";

// image processing (konverzia formátov, kompresia, resize...)
import sharp from "sharp";

// povolí requesty z inej domény (frontend → backend)
import cors from "cors";

// práca so súbormi a priečinkami
import fs from "fs";
import path from "path";

// kvôli ES modules (__dirname tu defaultne neexistuje)
import { fileURLToPath } from "url";

// generovanie náhodných názvov súborov
import crypto from "crypto";


/* =====================================================
   PATH SETUP
   ===================================================== */

// nahrádza klasické __filename / __dirname z CommonJS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root = o úroveň vyššie než /server
const ROOT = path.resolve(__dirname, "..");

// priečinok kde sa dočasne ukladajú uploady
const UPLOADS = path.join(ROOT, "uploads");

// vytvorí priečinok ak neexistuje
fs.mkdirSync(UPLOADS, { recursive: true });


/* =====================================================
   EXPRESS SERVER SETUP
   ===================================================== */

const app = express();

// povolí CORS (frontend môže byť napr. na inom porte)
app.use(cors());

// servuje statické súbory z /public (HTML, CSS, JS)
app.use(express.static(path.join(ROOT, "public")));


/* =====================================================
   MULTER STORAGE (UPLOAD NASTAVENIE)
   ===================================================== */

const storage = multer.diskStorage({

  // kam sa uloží súbor
  destination: (_req, _file, cb) => cb(null, UPLOADS),

  // unikátny názov súboru aby sa neprepisovali
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".bin");

    cb(
      null,
      `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`
    );
  }
});


/* =====================================================
   MULTER INIT
   ===================================================== */

const upload = multer({
  storage,

  // max veľkosť 300MB (ochrana proti obrovským súborom)
  limits: { fileSize: 300 * 1024 * 1024 }
});


/* =====================================================
   HEALTH CHECK
   ===================================================== */

// jednoduchý endpoint pre test servera
app.get("/health", (_req, res) => res.json({ ok: true }));


/* =====================================================
   HLAVNÝ CONVERT ENDPOINT
   ===================================================== */

app.post("/convert", upload.single("image"), async (req, res) => {

  // multer uložený súbor
  const file = req.file;

  // funkcia na zmazanie dočasného uploadu
  const cleanup = async () => {
    if (file?.path) {
      try { await fs.promises.unlink(file.path); } catch {}
    }
  };

  try {

    // ak neprišiel žiadny súbor
    if (!file) return res.status(400).json({ error: "Missing image file" });


    /* ========= PARAMETRE ========= */

    // výstupný formát (?format=webp)
    const format = String(req.query.format || "avif").toLowerCase();

    // kvalita (?quality=70)
    const qRaw = Number(req.query.quality ?? 55);

    // clamp 1-95
    const quality = Number.isFinite(qRaw)
      ? Math.min(95, Math.max(1, qRaw))
      : 55;


    /* ========= SHARP SUPPORT CHECK ========= */

    // nie každá sharp build podporuje všetky formáty
    const supportsAvif = !!(sharp.format?.avif?.output);
    const supportsWebp = !!(sharp.format?.webp?.output);


    /* ========= IMAGE PIPELINE ========= */

    // načíta obrázok + auto rotate podľa EXIF
    let pipeline = sharp(file.path).rotate();

    let buffer, mime, ext;


    /* ========= KONVERZIA PODĽA FORMÁTU ========= */

    if (format === "avif") {

      if (!supportsAvif)
        return res.status(400).json({
          error: "Sharp build nepodporuje AVIF output. Skús WebP."
        });

      buffer = await pipeline.avif({ quality }).toBuffer();
      mime = "image/avif";
      ext = "avif";

    } else if (format === "webp") {

      if (!supportsWebp)
        return res.status(400).json({
          error: "Sharp build nepodporuje WebP output."
        });

      buffer = await pipeline.webp({ quality }).toBuffer();
      mime = "image/webp";
      ext = "webp";

    } else if (format === "jpg" || format === "jpeg") {

      buffer = await pipeline.jpeg({
        quality,
        mozjpeg: true // lepšia kompresia
      }).toBuffer();

      mime = "image/jpeg";
      ext = "jpg";

    } else {

      return res.status(400).json({
        error: "Unsupported format. Use avif/webp/jpg."
      });
    }


    /* ========= VALIDÁCIA ========= */

    if (!buffer || buffer.length === 0) {
      return res.status(500).json({
        error: "Conversion produced empty output."
      });
    }


    /* ========= ODOSLANIE SÚBORU ========= */

    // názov súboru bez pôvodnej prípony
    const baseName =
      (file.originalname || "image").replace(/\.[^.]+$/, "");

    const outName = `${baseName}.${ext}`;

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    res.setHeader("Content-Length", String(buffer.length));

    // pošle binárne dáta
    res.send(buffer);

    // zmaže dočasný upload
    await cleanup();

  } catch (err) {

    console.error(err);

    await cleanup();

    res.status(500).json({ error: "Conversion failed" });
  }
});


/* =====================================================
   MULTER ERROR HANDLER
   ===================================================== */

app.use((err, _req, res, next) => {

  // špecifické multer chyby
  if (err?.name === "MulterError") {

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "Súbor je príliš veľký (prekročený upload limit servera).",
        code: err.code
      });
    }

    return res.status(400).json({
      error: "Upload chyba.",
      code: err.code
    });
  }

  // všeobecná chyba servera
  if (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error." });
  }

  next();
});


/* =====================================================
   SERVER START
   ===================================================== */

const port = process.env.PORT || 3000;

app.listen(port, () =>
  console.log(`🚀 Server: http://localhost:${port}`)
);


/* =====================================================
   CAPABILITIES ENDPOINT
   ===================================================== */

// frontend vie zistiť ktoré formáty server podporuje
app.get("/capabilities", (_req, res) => {
  res.json({
    avif: !!(sharp.format?.avif?.output),
    webp: !!(sharp.format?.webp?.output),
    jpg: true
  });
});
