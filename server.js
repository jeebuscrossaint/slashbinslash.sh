const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const rateLimit = require("express-rate-limit");

const statsPath = path.join(__dirname, "stats.json");

// Constants configuration (previously in .env)
const PORT = 3000;
const NC_PORT = 9999;
const HOST = "localhost";
const UPLOAD_DIR = path.join(__dirname, "uploads");
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 14;

// Load or initialize statistics
function loadStats() {
  if (fs.existsSync(statsPath)) {
    try {
      return JSON.parse(fs.readFileSync(statsPath, "utf-8"));
    } catch (err) {
      console.error("Error reading stats file:", err);
    }
  }

  // Enhanced stats structure with storage tracking
  return {
    allTime: {
      uploads: 0,
      totalSize: 0, // Track total size of all uploads
      lastUpdated: new Date().toISOString(),
    },
    last7Days: {
      uploads: 0,
      totalSize: 0, // Track size of uploads in last 7 days
      lastUpdated: new Date().toISOString(),
    },
    fileTypes: {}, // Track file type distribution
    dailyStats: [],
  };
}

// Save statistics
function saveStats(stats) {
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

function getFileIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();

  // Define icon mapping
  const icons = {
    pdf: "📄",
    doc: "📝",
    docx: "📝",
    xls: "📊",
    xlsx: "📊",
    ppt: "📊",
    pptx: "📊",
    txt: "📄",
    md: "📄",
    jpg: "🖼️",
    jpeg: "🖼️",
    png: "🖼️",
    gif: "🖼️",
    bmp: "🖼️",
    mp3: "🎵",
    wav: "🎵",
    ogg: "🎵",
    mp4: "🎬",
    avi: "🎬",
    mov: "🎬",
    mkv: "🎬",
    zip: "📦",
    rar: "📦",
    "7z": "📦",
    tar: "📦",
    gz: "📦",
    html: "🌐",
    css: "🌐",
    js: "🌐",
    exe: "⚙️",
    dll: "⚙️",
    sh: "📜",
    bash: "📜",
  };

  return icons[ext] || "📄"; // Default icon
}

// Update recordUpload to track file size and type
function recordUpload(fileSize, fileType) {
  const stats = loadStats();
  const now = new Date();

  // Log the change
  console.log(`Recording upload: ${formatSize(fileSize)} ${fileType} file`);

  // Increment all-time counter
  stats.allTime.uploads++;
  stats.allTime.totalSize = (stats.allTime.totalSize || 0) + (fileSize || 0);
  stats.allTime.lastUpdated = now.toISOString();

  // Find or create today's entry
  const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  let todayEntry = stats.dailyStats.find((entry) => entry.date === todayStr);

  if (!todayEntry) {
    todayEntry = { date: todayStr, uploads: 0, totalSize: 0 };
    stats.dailyStats.push(todayEntry);
  }

  // Update today's entry
  todayEntry.uploads++;
  todayEntry.totalSize = (todayEntry.totalSize || 0) + (fileSize || 0);

  // Track file type statistics
  if (fileType) {
    if (!stats.fileTypes) stats.fileTypes = {};
    stats.fileTypes[fileType] = (stats.fileTypes[fileType] || 0) + 1;
  }

  // Cleanup old entries (keep only last 30 days)
  stats.dailyStats.sort((a, b) => b.date.localeCompare(a.date)); // Sort by date, newest first
  stats.dailyStats = stats.dailyStats.slice(0, 30); // Keep only last 30 days

  // Calculate last 7 days
  const last7Days = stats.dailyStats.slice(0, 7);
  stats.last7Days.uploads = last7Days.reduce(
    (sum, day) => sum + day.uploads,
    0,
  );
  stats.last7Days.totalSize = last7Days.reduce(
    (sum, day) => sum + (day.totalSize || 0),
    0,
  );
  stats.last7Days.lastUpdated = now.toISOString();

  // Add human-readable size statistics
  stats.allTime.humanReadableSize = formatSize(stats.allTime.totalSize || 0);
  stats.last7Days.humanReadableSize = formatSize(
    stats.last7Days.totalSize || 0,
  );

  console.log(
    `Updated stats: Total uploads: ${stats.allTime.uploads}, Total size: ${stats.allTime.humanReadableSize}`,
  );

  saveStats(stats);
}

// Helper function to extract file extension
function getFileType(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  return ext || "unknown";
}

function generateShortId(length = 4) {
  // Use more characters than just hex (0-9, a-f) to get shorter IDs
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

// Create uploads directory if it doesn't exist
const uploadsDir = UPLOAD_DIR;
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Limit each IP to 100 upload requests per hour
  message: "Too many uploads from this IP, please try again after an hour",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Rate limiter specifically for netcat uploads from same IP
const ncConnections = new Map();
const NC_RATE_LIMIT = 100; // 100 uploads per hour
const NC_WINDOW_MS = 60 * 60 * 1000; // 1 hour in milliseconds

function checkNcRateLimit(ip) {
  const now = Date.now();
  if (!ncConnections.has(ip)) {
    ncConnections.set(ip, [now]);
    return true;
  }

  const connections = ncConnections.get(ip);
  // Filter connections to only include those within the time window
  const recentConnections = connections.filter(
    (time) => now - time < NC_WINDOW_MS,
  );

  if (recentConnections.length >= NC_RATE_LIMIT) {
    return false; // Rate limit exceeded
  }

  // Add current connection time and update the map
  recentConnections.push(now);
  ncConnections.set(ip, recentConnections);
  return true;
}

// Clean up old netcat rate limit data periodically
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, times] of ncConnections.entries()) {
      const recentTimes = times.filter((time) => now - time < NC_WINDOW_MS);
      if (recentTimes.length === 0) {
        ncConnections.delete(ip);
      } else {
        ncConnections.set(ip, recentTimes);
      }
    }
  },
  60 * 60 * 1000,
); // Clean up every hour

// Configure file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Generate a short ID
    const fileId = generateShortId();

    // Attach fileId to the file object
    file.fileId = fileId;

    // Create a dedicated directory for this upload
    const uploadDir = path.join(uploadsDir, fileId);
    fs.mkdirSync(uploadDir, { recursive: true });

    // Get expiry days from request or default to 7
    let expiryDays = 7;

    if (req.body && req.body.expiryDays) {
      // Parse the expiry days and ensure it's within limits
      expiryDays = parseInt(req.body.expiryDays, 10) || 7;

      // Limit to 14 days maximum
      expiryDays = Math.min(Math.max(1, expiryDays), 14);
    }

    // Calculate expiry date based on the selected days
    const expiryDate = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    // Store original filename information
    const fileInfo = {
      originalName: file.originalname,
      uploadDate: new Date().toISOString(),
      expiryDate: expiryDate.toISOString(),
      expiryDays: expiryDays,
    };

    // Save file metadata
    fs.writeFileSync(
      path.join(uploadDir, "metadata.json"),
      JSON.stringify(fileInfo),
    );

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Store with the original filename
    cb(null, file.originalname);
  },
});

// Configure upload limits
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

// Netcat server - complete rewrite for better performance
const ncServer = net.createServer((socket) => {
  let data = Buffer.from("");
  let processed = false;
  const clientIP = socket.remoteAddress || "unknown";
  let inactivityTimer = null;

  console.log(`Netcat connection from ${clientIP}`);

  // Check rate limit for netcat connections
  if (!checkNcRateLimit(clientIP)) {
    socket.write("Error: Rate limit exceeded. Try again later.\n");
    socket.end();
    return;
  }

  // Set a short inactivity timer of 100ms
  const startInactivityTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (data.length > 0 && !processed) {
        handleUpload();
      }
    }, 100);
  };

  socket.on("data", (chunk) => {
    // Combine data chunks
    data = Buffer.concat([data, chunk]);

    // Reset the inactivity timer
    startInactivityTimer();

    // Size limit check (10MB)
    if (data.length > 10 * 1024 * 1024) {
      socket.end("Error: Data too large\n");
      socket.destroy();
      return;
    }

    // Process immediately if we detect EOT character
    if (chunk.includes(0x04)) {
      handleUpload();
    }
  });

  socket.on("end", () => {
    if (!processed && data.length > 0) {
      handleUpload();
    }
  });

  socket.on("error", (err) => {
    console.error(`Netcat error: ${err.message}`);
    socket.destroy();
  });

  function stripAnsiCodes(str) {
    return str.replace(/\u001b\[\d+(;\d+)*m/g, "");
  }

  // Inside the handleUpload function for netcat
  function handleUpload() {
    if (processed || data.length === 0) return;
    processed = true;
    clearTimeout(inactivityTimer);

    try {
      // Generate a shorter ID
      const fileId = generateShortId();

      const uploadDir = path.join(uploadsDir, fileId);
      fs.mkdirSync(uploadDir, { recursive: true });

      const fileName = `paste.txt`;

      // For netcat uploads, use the standard 7 days expiry
      const expiryDays = DEFAULT_EXPIRY_DAYS;
      const expiryDate = new Date(
        Date.now() + expiryDays * 24 * 60 * 60 * 1000,
      );

      // Save metadata
      const fileInfo = {
        originalName: fileName,
        uploadDate: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        expiryDays: expiryDays,
      };

      fs.writeFileSync(
        path.join(uploadDir, "metadata.json"),
        JSON.stringify(fileInfo),
      );

      // Clean the data by removing ANSI color codes before saving
      const cleanData = stripAnsiCodes(data.toString("utf-8"));

      // Save file with cleaned data
      fs.writeFileSync(path.join(uploadDir, fileName), cleanData);

      // Return a simplified URL
      const fullUrl = `http://${HOST}:${PORT}/${fileId}`;

      recordUpload(cleanData.length, "txt"); // Netcat uploads are always text

      // Include the expiry information in the response
      socket.write(`${fullUrl} (expires in ${expiryDays} days)\n`);
      socket.end();
    } catch (err) {
      console.error("Upload error:", err);
      socket.write("Server error during upload\n");
      socket.end();
    }
  }
});

ncServer.listen(NC_PORT, () => {
  console.log(`Netcat server listening on port ${NC_PORT}`);
});

ncServer.on("error", (err) => {
  console.error(`Netcat server error: ${err.message}`);
});

// Update the homepage route to remove file types from the stats display
app.get("/", (req, res) => {
  const stats = loadStats();

  // Add human-readable sizes if they don't exist
  if (!stats.allTime.humanReadableSize) {
    stats.allTime.humanReadableSize = formatSize(stats.allTime.totalSize || 0);
  }
  if (!stats.last7Days.humanReadableSize) {
    stats.last7Days.humanReadableSize = formatSize(
      stats.last7Days.totalSize || 0,
    );
  }

  // Read the index.html file
  let html = fs.readFileSync(
    path.join(__dirname, "public", "index.html"),
    "utf8",
  );

  // Create simplified statistics HTML without file types
  const statsHtml = `
        <div class="stats-section">
            <div class="info-box stats-box">
                <h3>Upload Statistics</h3>
                <p>All time uploads: <span class="stat-number">${stats.allTime.uploads.toLocaleString()}</span></p>
                <p>Total storage used: <span class="stat-number">${stats.allTime.humanReadableSize}</span></p>
                <p>Last 7 days: <span class="stat-number">${stats.last7Days.uploads.toLocaleString()}</span> uploads</p>
                <p>Storage in last 7 days: <span class="stat-number">${stats.last7Days.humanReadableSize}</span></p>
                <p class="updated-time">Last updated: ${new Date(stats.allTime.lastUpdated).toLocaleString()}</p>
            </div>
        </div>`;

  // Use a more reliable insertion method
  html = html.replace(
    /<\/div>\s*<footer>/,
    `${statsHtml}\n    </div>\n    <footer>`,
  );

  res.send(html);
});
// Serve static files
app.use(express.static("public"));

// Handle file uploads
app.post("/upload", uploadLimiter, (req, res) => {
  // Configure multer to handle both the file and form fields in one go
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).send("File size exceeds 100MB limit.");
      }
      return res.status(500).send("Upload failed.");
    }

    if (!req.file) {
      return res.status(400).send("No file uploaded.");
    }

    // Get expiry days from request or default to 7
    let expiryDays = DEFAULT_EXPIRY_DAYS;
    if (req.body && req.body.expiryDays) {
      // Parse the expiry days and ensure it's within limits
      expiryDays = parseInt(req.body.expiryDays, 10) || DEFAULT_EXPIRY_DAYS;

      // Limit to 14 days maximum
      expiryDays = Math.min(Math.max(1, expiryDays), MAX_EXPIRY_DAYS);
    }

    // Update the file metadata with the correct expiry days
    const metadataPath = path.join(
      uploadsDir,
      req.file.fileId,
      "metadata.json",
    );
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
        metadata.expiryDays = expiryDays;
        metadata.expiryDate = new Date(
          Date.now() + expiryDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        fs.writeFileSync(metadataPath, JSON.stringify(metadata));
      } catch (err) {
        console.error("Error updating metadata:", err);
      }
    }

    // Create full URL
    const fullUrl = `${req.protocol}://${req.get("host")}/${req.file.fileId}`;

    // Create response data
    const responseData = {
      fileId: req.file.fileId,
      fileName: req.file.originalname,
      url: req.file.fileId,
      fullUrl: fullUrl,
      message: "File uploaded successfully.",
      expiryDays: expiryDays,
    };

    // Add logging for HTTP uploads
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";
    const userAgent = req.get("User-Agent") || "unknown";
    const fileSize = req.file.size;

    console.log(
      `HTTP upload from ${clientIP} - File: "${req.file.originalname}" (${formatSize(fileSize)}) - ID: ${req.file.fileId} - Agent: ${userAgent}`,
    );

    // Record this upload in statistics
    const fileExt = getFileType(req.file.originalname);
    recordUpload(req.file.size, fileExt);

    // Check if request is from curl (or similar CLI tool)
    const isCommandLine =
      userAgent.includes("curl") ||
      userAgent.includes("Wget") ||
      req.query.cli === "true";

    if (isCommandLine) {
      // Return plain text URL for command line clients
      return res.type("text/plain").send(fullUrl);
    } else {
      // Return JSON for browser/API clients
      return res.status(200).json(responseData);
    }
  });
});

// Helper function to format file sizes for logging and stats
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  else if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  else return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

app.get("/up.sh", (req, res) => {
  const protocol = req.protocol;
  const host = req.get("host") || `${HOST}:${PORT}`;

  // Generate a simple bash script as a string
  const bashScript = `#!/bin/bash
# slashbinslash.sh upload script with multiple file support

# Configuration - change these to match your server
SERVER="${host}"
PROTOCOL="${protocol}"
DEFAULT_EXPIRY_DAYS=${DEFAULT_EXPIRY_DAYS}

# Function to upload a single file
upload_single_file() {
    local file="$1"
    local expiry_days=\${2:-$DEFAULT_EXPIRY_DAYS}
    echo "Uploading file: $file"
    result=$(curl -s -F "file=@$file" -F "expiryDays=$expiry_days" "$PROTOCOL://$SERVER/upload")

    # Check if result is plain text (probably a URL)
    if [[ $result == http* ]]; then
        echo "$result"
        return 0
    fi

    # If not plain text, try to parse as JSON to get the fileId
    fileId=$(echo $result | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
    if [ -z "$fileId" ]; then
        fileId=$(echo $result | grep -o '"fileId":"[^"]*"' | cut -d'"' -f4)
        if [ -z "$fileId" ]; then
            echo "Upload failed or unexpected response: $result"
            return 1
        fi
    fi

    echo "$PROTOCOL://$SERVER/$fileId"
    return 0
}

# Function to upload multiple files as a collection
upload_multiple_files() {
    local files=("$@")
    local count=\${#files[@]}
    local expiry_days="$DEFAULT_EXPIRY_DAYS"

    echo "Uploading $count files as collection..."

    # Extract expiry days if it's the first argument with -e prefix
    if [[ "\${files[0]}" == -e* ]]; then
        expiry_days="\${files[0]#-e}"
        files=("\${files[@]:1}")  # Remove the first element (the expiry option)
        count=$((count-1))
    fi

    # Build curl command with multiple -F file arguments
    local curl_cmd="curl -s"
    for ((i=0; i<count; i++)); do
        file="\${files[$i]}"
        curl_cmd+=" -F \\"file=@$file\\""
    done
    curl_cmd+=" -F \\"expiryDays=$expiry_days\\" \\"$PROTOCOL://$SERVER/upload-multiple\\""

    # Run the curl command
    result=$(eval $curl_cmd)

    # Parse the result to get collection URL
    if echo "$result" | grep -q '"collectionId"'; then
        collectionId=$(echo "$result" | grep -o '"collectionId":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$collectionId" ]; then
            echo "$PROTOCOL://$SERVER/$collectionId (Collection of $count files)"
            return 0
        fi
    elif [ "$count" -eq 1 ] && echo "$result" | grep -q '"fileId"'; then
        # Handle case where only one file was found
        fileId=$(echo "$result" | grep -o '"fileId":"[^"]*"' | head -1 | cut -d'"' -f4)
        if [ -n "$fileId" ]; then
            echo "$PROTOCOL://$SERVER/$fileId"
            return 0
        fi
    fi

    echo "Upload failed or unexpected response: $result"
    return 1
}

# Function to check if an argument is a glob pattern
is_glob_pattern() {
    [[ "$1" == *\\** || "$1" == *\\?* || "$1" == *\\[* ]]
}

# Function to handle piped input
handle_pipe_input() {
    echo "Uploading from pipe..."
    # Create a temporary file to store the piped content
    temp_file=$(mktemp)
    cat > "$temp_file"
    upload_single_file "$temp_file"
    rm -f "$temp_file"
}

# Main script logic
if [ -t 0 ]; then
    # Input is from arguments (files), not a pipe
    if [ $# -eq 0 ]; then
        echo "Usage: $0 [options] <file(s)> or command | $0"
        echo "Options:"
        echo "  -e<days>  Set expiry days (1-14, default is 7)"
        echo "Examples:"
        echo "  $0 file.txt                  # Upload a single file"
        echo "  $0 -e14 file.txt             # Upload with 14-day expiry"
        echo "  $0 *.pdf                     # Upload multiple PDFs as collection"
        echo "  $0 -e3 file1.txt file2.jpg   # Upload collection with 3-day expiry"
        exit 1
    fi

    # Check for expiry option
    expiry_option=""
    if [[ "$1" == -e* ]]; then
        expiry_option="$1"
        shift
    fi

    # If only one file and not a glob pattern, upload as single file
    if [ $# -eq 1 ] && ! is_glob_pattern "$1" && [ -f "$1" ]; then
        if [ -n "$expiry_option" ]; then
            upload_single_file "$1" "\${expiry_option#-e}"
        else
            upload_single_file "$1"
        fi
    else
        # Multiple files or glob pattern - collect all matching files
        files=()
        for pattern in "$@"; do
            # Check if this is a glob pattern that needs expansion
            if is_glob_pattern "$pattern"; then
                # Expand the glob pattern and add matching files
                for file in $pattern; do
                    if [ -f "$file" ]; then
                        files+=("$file")
                    fi
                done
            elif [ -f "$pattern" ]; then
                # Add the individual file
                files+=("$pattern")
            else
                echo "Warning: '$pattern' is not a valid file, skipping."
            fi
        done

        # Check if we found any files
        if [ \${#files[@]} -eq 0 ]; then
            echo "No valid files found to upload."
            exit 1
        fi

        # Upload the collection
        if [ -n "$expiry_option" ]; then
            upload_multiple_files "$expiry_option" "\${files[@]}"
        else
            upload_multiple_files "\${files[@]}"
        fi
    fi
else
    # Input is from a pipe
    handle_pipe_input
fi`;

  res.type("text/plain");
  res.send(bashScript);
});

// Serve PowerShell upload script
app.get("/up.ps1", (req, res) => {
  const protocol = req.protocol;
  const host = req.get("host") || `${HOST}:${PORT}`;

  // Generate a PowerShell script as a string
  const powershellScript = `# slashbinslash.sh PowerShell upload script (up.ps1) with multiple file support

# Configuration - change these to match your server
$SERVER = "${host}"
$PROTOCOL = "${protocol}"
$DEFAULT_EXPIRY_DAYS = ${DEFAULT_EXPIRY_DAYS}

function Upload-SingleFile {
    param (
        [string]$FilePath,
        [int]$ExpiryDays = $DEFAULT_EXPIRY_DAYS
    )

    Write-Host "Uploading file: $FilePath"

    # Use curl.exe for consistency with the bash version
    $result = (curl.exe -s -F "file=@$FilePath" -F "expiryDays=$ExpiryDays" "$PROTOCOL\`://$SERVER/upload") | Out-String

    return Process-Result $result
}

function Upload-MultipleFiles {
    param (
        [string[]]$FilePaths,
        [int]$ExpiryDays = $DEFAULT_EXPIRY_DAYS
    )

    $fileCount = $FilePaths.Count
    Write-Host "Uploading $fileCount files as collection..."

    # Build curl command with multiple -F files arguments
    $curlArgs = @("-s")
    foreach ($file in $FilePaths) {
        $curlArgs += "-F"
        $curlArgs += "file=@\`"$file\`""
    }

    $curlArgs += "-F"
    $curlArgs += "expiryDays=$ExpiryDays"
    $curlArgs += "$PROTOCOL\`://$SERVER/upload-multiple"

    # Execute the curl command
    $result = (& curl.exe $curlArgs) | Out-String

    # Parse the result to get collection URL
    if ($result -match '"collectionId":"([^"]+)"') {
        $collectionId = $matches[1]
        return "$PROTOCOL\`://$SERVER/$collectionId (Collection of $fileCount files)"
    }
    elseif ($fileCount -eq 1 -and $result -match '"fileId":"([^"]+)"') {
        # Handle case where only one file was found
        $fileId = $matches[1]
        return "$PROTOCOL\`://$SERVER/$fileId"
    }
    else {
        Write-Error "Upload failed or unexpected response: $result"
        return $null
    }
}

function Upload-Pipe {
    param (
        [int]$ExpiryDays = $DEFAULT_EXPIRY_DAYS
    )

    Write-Host "Uploading from pipe..."

    # Create a temporary file to store the piped content
    $tempFile = [System.IO.Path]::GetTempFileName()

    try {
        # Read from standard input and write to the temp file
        $input | Out-File -FilePath $tempFile -Encoding ascii

        # Upload the temp file
        $result = (curl.exe -s -F "file=@$tempFile" -F "expiryDays=$ExpiryDays" "$PROTOCOL\`://$SERVER/upload") | Out-String

        return Process-Result $result
    }
    finally {
        # Clean up the temp file
        if (Test-Path $tempFile) {
            Remove-Item -Path $tempFile -Force
        }
    }
}

function Process-Result {
    param (
        [string]$result
    )

    # Check if result is plain text (probably a URL)
    if ($result -match "^http") {
        return $result.Trim()
    }

    # If not plain text, try to parse as JSON to get the fileId
    if ($result -match '"url":"([^"]+)"') {
        $fileId = $matches[1]
        return "$PROTOCOL\`://$SERVER/$fileId"
    }
    elseif ($result -match '"fileId":"([^"]+)"') {
        # Alternative way to get fileId
        $fileId = $matches[1]
        return "$PROTOCOL\`://$SERVER/$fileId"
    }
    else {
        Write-Error "Upload failed or unexpected response: $result"
        return $null
    }
}

function Resolve-WildcardPaths {
    param (
        [string[]]$Paths
    )

    $resolvedFiles = @()

    foreach ($path in $Paths) {
        # Check if the path contains wildcards
        if ($path -match '\\*' -or $path -match '\\?') {
            # Resolve the wildcard path to actual files
            $matchingFiles = Get-ChildItem -Path $path -File -ErrorAction SilentlyContinue
            if ($matchingFiles) {
                $resolvedFiles += $matchingFiles.FullName
            }
            else {
                Write-Warning "No files found matching pattern: $path"
            }
        }
        elseif (Test-Path -Path $path -PathType Leaf) {
            # It's a direct file path
            $resolvedFiles += (Resolve-Path $path).Path
        }
        else {
            Write-Warning "File not found: $path"
        }
    }

    return $resolvedFiles
}

# Main execution flow
[int]$expiryDays = $DEFAULT_EXPIRY_DAYS

# Check if we have arguments and not reading from a pipe
if ($args.Count -gt 0 -and -not [Console]::IsInputRedirected) {
    # Check if the first argument is an expiry option
    if ($args[0] -match '^-e(\\d+)$') {
        $expiryDays = [int]$matches[1]
        # Validate expiry days (1-14)
        if ($expiryDays -lt 1 -or $expiryDays -gt 14) {
            $expiryDays = $DEFAULT_EXPIRY_DAYS
            Write-Warning "Invalid expiry days. Using default: $DEFAULT_EXPIRY_DAYS days"
        }
        $filePaths = $args[1..($args.Count-1)]
    }
    else {
        $filePaths = $args
    }

    # Resolve all file paths including wildcards
    $files = Resolve-WildcardPaths -Paths $filePaths

    if ($files.Count -eq 0) {
        Write-Error "No valid files found to upload."
        exit 1
    }
    elseif ($files.Count -eq 1) {
        # Single file upload
        $result = Upload-SingleFile -FilePath $files[0] -ExpiryDays $expiryDays
        if ($result) {
            Write-Output $result
        }
    }
    else {
        # Multiple file upload
        $result = Upload-MultipleFiles -FilePaths $files -ExpiryDays $expiryDays
        if ($result) {
            Write-Output $result
        }
    }
}
elseif ([Console]::IsInputRedirected) {
    # Handle input from a pipe
    $result = Upload-Pipe -ExpiryDays $expiryDays
    if ($result) {
        Write-Output $result
    }
}
else {
    # Show usage information
    Write-Host "Usage:"
    Write-Host "  .\\up.ps1 [options] <file(s)> or command | .\\up.ps1"
    Write-Host "Options:"
    Write-Host "  -e<days>  Set expiry days (1-14, default is 7)"
    Write-Host "Examples:"
    Write-Host "  .\\up.ps1 file.txt                    # Upload a single file"
    Write-Host "  .\\up.ps1 -e14 file.txt               # Upload with 14-day expiry"
    Write-Host "  .\\up.ps1 C:\\folder\\*.pdf             # Upload multiple PDFs as collection"
    Write-Host "  .\\up.ps1 -e3 file1.txt file2.jpg     # Upload collection with 3-day expiry"
    exit 1
}`;

  res.type("text/plain");
  res.send(powershellScript);
});

app.get("/:id", (req, res) => {
  const id = req.params.id;
  const dirPath = path.join(uploadsDir, id);
  const metadataPath = path.join(dirPath, "metadata.json");

  // Check if directory exists
  if (!fs.existsSync(dirPath) || !fs.existsSync(metadataPath)) {
    return res.status(404).send("File or collection not found or has expired.");
  }

  // Read metadata
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));

    // Check if it has expired
    const expiryDate = new Date(metadata.expiryDate);
    if (expiryDate < new Date()) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return res.status(404).send("File or collection has expired.");
    }

    // Check if it's a collection
    if (metadata.isCollection) {
      // This is a collection - generate collection page
      let fileList = "";
      let totalSize = 0;

      metadata.files.forEach((file) => {
        const icon = getFileIcon(file.name);
        // Add file size to display if available
        const fileSize = file.size
          ? ` <span class="file-size">(${formatSize(file.size)})</span>`
          : "";
        fileList += `<li>${icon} <a href="/${file.fileId}">${file.name}</a>${fileSize}</li>`;

        // Sum up total size
        if (file.size) {
          totalSize += file.size;
        }
      });

      // Use stored total size if available, otherwise use calculated total
      const collectionSize = metadata.totalSize || totalSize;

      const html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>File Collection - slashbinslash.sh</title>
                    <link rel="stylesheet" href="/style.css">
                    <link rel="icon" href="/favicon.ico">
                    <style>
                        .collection-container {
                            max-width: 800px;
                            margin: 20px auto;
                            padding: 20px;
                            background-color: #000000;
                            border: 1px solid #00ff00;
                            border-radius: 5px;
                        }
                        .collection-title {
                            text-align: center;
                            margin-bottom: 20px;
                            padding-bottom: 10px;
                            border-bottom: 1px dashed #00ff00;
                        }
                        .collection-info {
                            margin-bottom: 20px;
                            color: #999;
                            font-size: 0.9em;
                            text-align: center;
                        }
                        .collection-files {
                            list-style-type: none;
                            padding: 0;
                        }
                        .collection-files li {
                            padding: 8px;
                            margin-bottom: 5px;
                            border: 1px solid #004400;
                            border-radius: 3px;
                            background-color: rgba(0, 20, 0, 0.3);
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .collection-files a {
                            color: #00ff00;
                            text-decoration: none;
                            flex-grow: 1;
                        }
                        .collection-files a:hover {
                            text-decoration: underline;
                        }
                        .file-size {
                            color: #888;
                            font-size: 0.85em;
                            margin-left: 8px;
                        }
                        .total-size {
                            margin-top: 10px;
                            text-align: right;
                            color: #00ff00;
                            font-size: 0.9em;
                        }
                    </style>
                </head>
                <body>
                    <div class="collection-container">
                        <h1 class="collection-title">File Collection</h1>
                        <div class="collection-info">
                            Uploaded on ${new Date(metadata.uploadDate).toLocaleString()}<br>
                            Expires on ${new Date(metadata.expiryDate).toLocaleString()}<br>
                            Contains ${metadata.files.length} file${metadata.files.length !== 1 ? "s" : ""}
                            <br>
                            Total size: ${formatSize(collectionSize)}
                        </div>
                        <ul class="collection-files">
                            ${fileList}
                        </ul>
                        <div class="collection-info">
                            <a href="/">Back to slashbinslash.sh</a>
                        </div>
                    </div>
                </body>
                </html>`;

      return res.send(html);
    } else {
      // This is a single file
      // For netcat uploads (paste.txt), serve the file directly
      const pastePath = path.join(dirPath, "paste.txt");
      if (fs.existsSync(pastePath)) {
        // Set plain text content type
        res.setHeader("Content-Type", "text/plain");
        return res.sendFile(pastePath);
      }

      // For HTTP uploads, redirect to the file with filename
      const files = fs
        .readdirSync(dirPath)
        .filter((f) => f !== "metadata.json");
      if (files.length > 0) {
        return res.redirect(`/${id}/${encodeURIComponent(files[0])}`);
      }

      return res.status(404).send("File content not found.");
    }
  } catch (err) {
    console.error(`Error processing ${id}:`, err);
    return res.status(500).send("Error processing request.");
  }
});

// Serve uploaded files
app.get("/:fileId/:fileName", (req, res) => {
  const fileId = req.params.fileId;
  const fileName = req.params.fileName;

  // Build paths
  const uploadDir = path.join(uploadsDir, fileId);
  const filePath = path.join(uploadDir, decodeURIComponent(fileName));
  const metadataPath = path.join(uploadDir, "metadata.json");

  // Check if directory and metadata exist
  if (!fs.existsSync(uploadDir) || !fs.existsSync(metadataPath)) {
    return res.status(404).send("File not found or has expired.");
  }

  // Check if the specific file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found or has expired.");
  }

  // Read file metadata
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));

  // Check if file has expired
  const expiryDate = new Date(metadata.expiryDate);
  if (expiryDate < new Date()) {
    // Delete the entire upload directory
    fs.rmSync(uploadDir, { recursive: true, force: true });
    return res.status(404).send("File has expired.");
  }

  // Set content disposition to use original filename
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(metadata.originalName)}"`,
  );
  res.sendFile(filePath);
});

// Add this new route for multiple file uploads - COMPLETELY REWRITTEN
app.post("/upload-multiple", uploadLimiter, (req, res) => {
  // Create a new multer upload instance specifically for arrays of files
  const multipleUpload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE },
  }).array("file", 20); // Accept up to 20 files with field name "file"

  multipleUpload(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).send("File size exceeds 100MB limit.");
      }
      return res.status(500).send("Upload failed: " + err.message);
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files uploaded.");
    }

    // Get expiry days from request or default
    let expiryDays = parseInt(req.body.expiryDays, 10) || DEFAULT_EXPIRY_DAYS;
    expiryDays = Math.min(Math.max(1, expiryDays), MAX_EXPIRY_DAYS);

    // Handle collection creation for multiple files or single file redirect
    if (req.files.length === 1) {
      // Single file - just return its info
      const file = req.files[0];

      // Record stats for this file
      const fileExt = getFileType(file.originalname);
      recordUpload(file.size, fileExt);

      return res.status(200).json({
        files: [
          {
            fileId: file.fileId,
            name: file.originalname,
            url: file.fileId,
          },
        ],
        expiryDays: expiryDays,
      });
    } else {
      // Multiple files - create a collection
      const collectionId = generateShortId();
      const collectionDir = path.join(uploadsDir, collectionId);
      fs.mkdirSync(collectionDir, { recursive: true });

      // Create collection metadata
      const collectionInfo = {
        isCollection: true,
        files: [],
        uploadDate: new Date().toISOString(),
        expiryDate: new Date(
          Date.now() + expiryDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
        expiryDays: expiryDays,
      };

      // Process each file
      const fileInfoList = [];
      let totalSize = 0;

      req.files.forEach((file) => {
        fileInfoList.push({
          fileId: file.fileId,
          name: file.originalname,
          url: file.fileId,
        });

        collectionInfo.files.push({
          fileId: file.fileId,
          name: file.originalname,
          size: file.size,
        });

        // Record stats for each file
        const fileExt = getFileType(file.originalname);
        recordUpload(file.size, fileExt);
        totalSize += file.size;
      });

      // Add total size to collection metadata
      collectionInfo.totalSize = totalSize;

      // Save collection metadata
      fs.writeFileSync(
        path.join(collectionDir, "metadata.json"),
        JSON.stringify(collectionInfo),
      );

      // Log the collection upload
      const clientIP = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.get("User-Agent") || "unknown";
      console.log(
        `HTTP collection upload from ${clientIP} - ${req.files.length} files (${formatSize(totalSize)}) - Collection ID: ${collectionId} - Agent: ${userAgent}`,
      );

      // Return response with collection info
      return res.status(200).json({
        collectionId: collectionId,
        files: fileInfoList,
        expiryDays: expiryDays,
      });
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Netcat server available on port ${NC_PORT}`);
});

function cleanupExpiredFiles() {
  console.log("Checking for expired files...");

  fs.readdir(uploadsDir, (err, dirs) => {
    if (err) {
      console.error("Error reading uploads directory:", err);
      return;
    }

    const now = new Date();

    dirs.forEach((dir) => {
      const uploadDir = path.join(uploadsDir, dir);
      const metadataPath = path.join(uploadDir, "metadata.json");

      // Skip if not a directory or no metadata
      if (!fs.existsSync(metadataPath)) return;

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
        const expiryDate = new Date(metadata.expiryDate);

        if (expiryDate < now) {
          // Delete the entire upload directory
          fs.rmSync(uploadDir, { recursive: true, force: true });
          console.log(`Deleted expired upload: ${dir}`);
        }
      } catch (err) {
        console.error(`Error processing directory ${dir}:`, err);
      }
    });
  });
}

// Run cleanup every hour
setInterval(cleanupExpiredFiles, 60 * 60 * 1000);
// Also run once at startup
cleanupExpiredFiles();
