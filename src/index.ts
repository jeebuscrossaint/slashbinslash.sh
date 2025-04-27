import * as express from "express";
import * as path from "path";
import * as fs from "fs";
import * as cron from "node-cron";
import { PORT, UPLOAD_DIR } from "./config";
import { upload, handleFileUpload, cleanupExpiredFiles } from "./fileHandler";

const app = express();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../public")));

// File upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  handleFileUpload(req, res);
});

// Serve uploaded files
app.get("/:filename", (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found or expired");
  }

  res.sendFile(filePath);
});

// Schedule cleanup of expired files (run daily at midnight)
cron.schedule("0 0 * * *", cleanupExpiredFiles);

// Start server
app.listen(PORT, () => {
  console.log(`slashbinslash.sh server running on port ${PORT}`);
});
