const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "../uploads");
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
const FILE_EXPIRY_DAYS = 3;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate a random filename
    const randomName = crypto.randomBytes(4).toString("hex");
    const extension = path.extname(file.originalname);
    cb(null, `${randomName}${extension}`);
  },
});

// Configure file upload middleware
const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    cb(null, true); // Accept all files
  },
});

// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

// Upload route
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  const fileUrl = `${req.protocol}://${req.get("host")}/${req.file.filename}`;

  // Return URL for curl uploads
  if (req.get("User-Agent").includes("curl")) {
    return res.send(fileUrl);
  }

  // Return JSON for other clients
  res.json({
    url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
    expires: new Date(Date.now() + FILE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
  });
});

// Serve uploaded files
app.get("/:filename", (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found or expired");
  }

  res.sendFile(filePath);
});

// Schedule cleanup of expired files (run daily at midnight)
cron.schedule("0 0 * * *", () => {
  console.log("Cleaning up expired files...");
  const now = Date.now();
  const expiryTime = FILE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      return console.error("Error reading upload directory:", err);
    }

    files.forEach((file) => {
      const filePath = path.join(UPLOAD_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          return console.error(`Error getting stats for ${file}:`, err);
        }

        const fileAge = now - stats.mtime.getTime();
        if (fileAge > expiryTime) {
          fs.unlink(filePath, (err) => {
            if (err) {
              return console.error(`Error deleting ${file}:`, err);
            }
            console.log(`Deleted expired file: ${file}`);
          });
        }
      });
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`slashbinslash.sh server running on port ${PORT}`);
  console.log(`Files will expire after ${FILE_EXPIRY_DAYS} days`);
  console.log(`Maximum file size: ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`);
});
