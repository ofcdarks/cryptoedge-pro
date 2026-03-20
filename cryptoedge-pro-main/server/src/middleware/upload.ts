import multer from "multer";
import path from "path";
import fs from "fs";
import { AuthRequest } from "../types";

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    const userDir = path.join(UPLOAD_DIR, String((req as AuthRequest).userId));
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
  const allowed = /\.(jpg|jpeg|png|gif|webp|svg|mp4|mov|avi|mp3|wav|pdf|psd|ai|zip|json|srt|vtt|ttf|otf|woff2?)$/i;
  if (allowed.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error("Tipo de arquivo não permitido"));
  }
};

export const upload = multer({ storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } });
export { UPLOAD_DIR };
