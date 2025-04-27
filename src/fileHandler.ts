import * as fs from "fs";
import * as path from "path";
import * as multer from "multer";
import { Request, Response } from "express";
import { generateRandomFilename, calculateExpiryDate } from "./utils";
import { UPLOAD_DIR, FILE_EXPIRY_DAYS, MAX_FILE_SIZE } from "./config";

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const randomName = generateRandomFilename(file.originalname);
    cb(null, randomName);
  },
});

// Configure multer
export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});

// Handle file upload
export function handleFileUpload(req: Request, res: Response): void {
  if (!req.file) {
    res.status(400).send("No file uploaded");
    return;
  }

  const fileUrl = `${req.protocol}://${req.get("host")}/${req.file.filename}`;

  // Return plain text URL for curl requests
  if (req.get("User-Agent")?.includes("curl")) {
    res.send(fileUrl);
    return;
  }

  // Return JSON for other clients
  res.json({
    url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
    expires: calculateExpiryDate(FILE_EXPIRY_DAYS),
  });
}

// Clean up expired files
export function cleanupExpiredFiles(): void {
  console.log("Cleaning up expired files...");
  const now = new Date().getTime();
  const expiryTime = FILE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      console.error("Error reading upload directory:", err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(UPLOAD_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for ${file}:`, err);
          return;
        }

        const fileAge = now - stats.mtime.getTime();
        if (fileAge > expiryTime) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting ${file}:`, err);
              return;
            }
            console.log(`Deleted expired file: ${file}`);
          });
        }
      });
    });
  });
}
