const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

const NC_PORT = 9999; // Port for netcat listener same one as termbin for all the termbinners out there

const statsPath = path.join(__dirname, 'stats.json');

// Load or initialize statistics
function loadStats() {
        if (fs.existsSync(statsPath)) {
            try {
                return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
            } catch (err) {
                console.error('Error reading stats file:', err);
            }
        }
        
        // Default stats structure
        return {
            allTime: {
                uploads: 0,
                lastUpdated: new Date().toISOString()
            },
            last7Days: {
                uploads: 0,
                lastUpdated: new Date().toISOString()
            },
            dailyStats: []
        };
    }
    
    // Save statistics
    function saveStats(stats) {
        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    }
    
    // Increment upload count
    function recordUpload() {
        const stats = loadStats();
        const now = new Date();
        
        // Increment all-time counter
        stats.allTime.uploads++;
        stats.allTime.lastUpdated = now.toISOString();
        
        // Find or create today's entry
        const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        let todayEntry = stats.dailyStats.find(entry => entry.date === todayStr);
        
        if (!todayEntry) {
            todayEntry = { date: todayStr, uploads: 0 };
            stats.dailyStats.push(todayEntry);
        }
        
        todayEntry.uploads++;
        
        // Cleanup old entries (keep only last 30 days)
        stats.dailyStats.sort((a, b) => b.date.localeCompare(a.date)); // Sort by date, newest first
        stats.dailyStats = stats.dailyStats.slice(0, 30); // Keep only last 30 days
        
        // Calculate last 7 days
        const last7Days = stats.dailyStats.slice(0, 7);
        stats.last7Days.uploads = last7Days.reduce((sum, day) => sum + day.uploads, 0);
        stats.last7Days.lastUpdated = now.toISOString();
        
        saveStats(stats);
    }


function generateShortId(length = 4) {
        // Use more characters than just hex (0-9, a-f) to get shorter IDs
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        const randomBytes = crypto.randomBytes(length);
        for (let i = 0; i < length; i++) {
            result += chars[randomBytes[i] % chars.length];
        }
        return result;
    }

// Netcat server - complete rewrite for better performance
const ncServer = net.createServer((socket) => {
        let data = Buffer.from('');
        let processed = false;
        const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        let inactivityTimer = null;
        
        console.log(`Netcat connection from ${clientAddress}`);
        
        // Set a short inactivity timer of 100ms
        const startInactivityTimer = () => {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                if (data.length > 0 && !processed) {
                    handleUpload();
                }
            }, 100);
        };
        
        socket.on('data', (chunk) => {
            // Combine data chunks
            data = Buffer.concat([data, chunk]);
            
            // Reset the inactivity timer
            startInactivityTimer();
            
            // Size limit check (10MB)
            if (data.length > 10 * 1024 * 1024) {
                socket.end('Error: Data too large\n');
                socket.destroy();
                return;
            }
            
            // Process immediately if we detect EOT character
            if (chunk.includes(0x04)) {
                handleUpload();
            }
        });
        
        socket.on('end', () => {
            if (!processed && data.length > 0) {
                handleUpload();
            }
        });
        
        socket.on('error', (err) => {
            console.error(`Netcat error: ${err.message}`);
            socket.destroy();
        });
        
        function stripAnsiCodes(str) {
                return str.replace(/\u001b\[\d+(;\d+)*m/g, '');
            }
            
            // Then modify the handleUpload function in the netcat server section:
            function handleUpload() {
                if (processed || data.length === 0) return;
                processed = true;
                clearTimeout(inactivityTimer);
                
                try {
                    // Generate a shorter ID (6 characters like termbin uses)
                    const fileId = generateShortId();
                    
                    const uploadDir = path.join(uploadsDir, fileId);
                    fs.mkdirSync(uploadDir, { recursive: true });
                    
                    const fileName = `paste.txt`;
                    
                    // Save metadata
                    const fileInfo = {
                        originalName: fileName,
                        uploadDate: new Date().toISOString(),
                        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                    };
                    
                    fs.writeFileSync(
                        path.join(uploadDir, 'metadata.json'),
                        JSON.stringify(fileInfo)
                    );
                    
                    // Clean the data by removing ANSI color codes before saving
                    const cleanData = stripAnsiCodes(data.toString('utf-8'));
                    
                    // Save file with cleaned data
                    fs.writeFileSync(path.join(uploadDir, fileName), cleanData);
                    
                    // Return a simplified URL like termbin
                    const fullUrl = `http://${process.env.HOST || 'localhost'}:${PORT}/${fileId}`;

                    recordUpload(); // Increment upload count
                    
                    socket.write(fullUrl + '\n');
                    socket.end();
                    
                } catch (err) {
                    console.error('Upload error:', err);
                    socket.write('Server error during upload\n');
                    socket.end();
                }
            }
    });
    
    ncServer.listen(NC_PORT, () => {
        console.log(`Netcat server listening on port ${NC_PORT}`);
    });
    
    ncServer.on('error', (err) => {
        console.error(`Netcat server error: ${err.message}`);
    });

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configure file storage
// Configure file storage
const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            // Generate a random file ID
            const fileId = crypto.randomBytes(4).toString('hex');
            
            // Attach fileId to the file object so we can access it later
            file.fileId = fileId;
            
            // Create a dedicated directory for this upload
            const uploadDir = path.join(uploadsDir, fileId);
            fs.mkdirSync(uploadDir, { recursive: true });
            
            // Store original filename information
            const fileInfo = {
                originalName: file.originalname,
                uploadDate: new Date().toISOString(),
                expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            };
            
            // Save file metadata
            fs.writeFileSync(
                path.join(uploadDir, 'metadata.json'),
                JSON.stringify(fileInfo)
            );
            
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            // Store with the original filename
            cb(null, file.originalname);
        }
    });

// Configure upload limits
const upload = multer({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
    }
});

app.get('/', (req, res) => {
        const stats = loadStats();
        
        // Read the index.html file
        let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
        
        // Create the statistics HTML
        const statsHtml = `
        <div class="stats-section">
            <div class="info-box stats-box">
                <h3>Upload Statistics</h3>
                <p>All time uploads: <span class="stat-number">${stats.allTime.uploads.toLocaleString()}</span></p>
                <p>Last 7 days: <span class="stat-number">${stats.last7Days.uploads.toLocaleString()}</span></p>
                <p class="updated-time">Last updated: ${new Date(stats.allTime.lastUpdated).toLocaleString()}</p>
            </div>
        </div>
        `;
        
        // Insert the stats HTML before the footer
        html = html.replace('</div>\n    <footer>', `${statsHtml}\n    </div>\n    <footer>`);
        
        res.send(html);
    });

// Serve static files
app.use(express.static('public'));

// Handle file uploads
app.post('/upload', (req, res) => {
        upload.single('file')(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).send('File size exceeds 100MB limit.');
                }
                return res.status(500).send('Upload failed.');
            }
            
            if (!req.file) {
                return res.status(400).send('No file uploaded.');
            }
            
            // Create response data
            const responseData = {
                fileId: req.file.fileId,
                fileName: req.file.originalname,
                url: `${req.file.fileId}/${encodeURIComponent(req.file.originalname)}`,
                message: 'File uploaded successfully.'
            };
            
            // Add logging for HTTP uploads
            const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
            const userAgent = req.get('User-Agent') || 'unknown';
            const fileSize = req.file.size;
            
            console.log(`HTTP upload from ${clientIP} - File: "${req.file.originalname}" (${formatSize(fileSize)}) - ID: ${req.file.fileId} - Agent: ${userAgent}`);
            
            // Record this upload in statistics
            recordUpload();
            
            // Check if request is from curl (or similar CLI tool)
            const isCommandLine = userAgent.includes('curl') || userAgent.includes('Wget') || req.query.cli === 'true';
            
            if (isCommandLine) {
                // Return plain text URL for command line clients
                const fullUrl = `${req.protocol}://${req.get('host')}/${responseData.url}`;
                return res.type('text/plain').send(fullUrl);
            } else {
                // Return JSON for browser/API clients
                return res.status(200).json(responseData);
            }
        });
    });

// Helper function to format file sizes for logging
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// Serve command line upload script
app.get('/up.sh', (req, res) => {
    res.type('text/plain');
    res.send(`#!/bin/bash
# slashbinslash.sh upload script

if [ -t 0 ]; then
    # If input is from a file
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <file> or command | $0"
        exit 1
    fi
    
    if [ ! -f "$1" ]; then
        echo "Error: File not found."
        exit 1
    fi
    
    echo "Uploading file: $1"
    result=$(curl -s -F "file=@$1" https://slashbinslash.sh/upload)
else
    # If input is from a pipe
    echo "Uploading from pipe..."
    result=$(curl -s -F "file=@-" https://slashbinslash.sh/upload)
fi

# Parse the JSON to get the fileId
fileId=$(echo $result | grep -o '"fileId":"[^"]*"' | cut -d'"' -f4)
if [ -z "$fileId" ]; then
    echo "Upload failed: $result"
    exit 1
fi

echo "https://slashbinslash.sh/$fileId"
`);
});

// Serve uploaded files
app.get('/:fileId/:fileName', (req, res) => {
        const fileId = req.params.fileId;
        const fileName = req.params.fileName;
        
        // Build paths
        const uploadDir = path.join(uploadsDir, fileId);
        const filePath = path.join(uploadDir, decodeURIComponent(fileName));
        const metadataPath = path.join(uploadDir, 'metadata.json');
        
        // Check if directory and metadata exist
        if (!fs.existsSync(uploadDir) || !fs.existsSync(metadataPath)) {
            return res.status(404).send('File not found or has expired.');
        }
        
        // Check if the specific file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found or has expired.');
        }
        
        // Read file metadata
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        
        // Check if file has expired
        const expiryDate = new Date(metadata.expiryDate);
        if (expiryDate < new Date()) {
            // Delete the entire upload directory
            fs.rmSync(uploadDir, { recursive: true, force: true });
            return res.status(404).send('File has expired.');
        }
        
        // Set content disposition to use original filename
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(metadata.originalName)}"`);
        res.sendFile(filePath);
    });
    
    // Add a redirect for old-style URLs
    app.get('/:fileId', (req, res) => {
        const fileId = req.params.fileId;
        const uploadDir = path.join(uploadsDir, fileId);
        
        // If directory doesn't exist, return 404
        if (!fs.existsSync(uploadDir)) {
            return res.status(404).send('File not found or has expired.');
        }
        
        // Check for metadata
        const metadataPath = path.join(uploadDir, 'metadata.json');
        if (!fs.existsSync(metadataPath)) {
            return res.status(404).send('File metadata not found or has expired.');
        }
        
        // Read metadata
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        
        // Check if file has expired
        const expiryDate = new Date(metadata.expiryDate);
        if (expiryDate < new Date()) {
            // Delete the entire upload directory
            fs.rmSync(uploadDir, { recursive: true, force: true });
            return res.status(404).send('File has expired.');
        }
        
        // For netcat uploads (paste.txt), serve the file directly
        const pastePath = path.join(uploadDir, 'paste.txt');
        if (fs.existsSync(pastePath)) {
            // Set plain text content type
            res.setHeader('Content-Type', 'text/plain');
            return res.sendFile(pastePath);
        }
        
        // For HTTP uploads, redirect to the file with filename
        const files = fs.readdirSync(uploadDir).filter(f => f !== 'metadata.json');
        if (files.length > 0) {
            return res.redirect(`/${fileId}/${encodeURIComponent(files[0])}`);
        }
        
        return res.status(404).send('File content not found.');
    });

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

function cleanupExpiredFiles() {
        console.log('Checking for expired files...');
        
        fs.readdir(uploadsDir, (err, dirs) => {
            if (err) {
                console.error('Error reading uploads directory:', err);
                return;
            }
            
            const now = new Date();
            
            dirs.forEach(dir => {
                const uploadDir = path.join(uploadsDir, dir);
                const metadataPath = path.join(uploadDir, 'metadata.json');
                
                // Skip if not a directory or no metadata
                if (!fs.existsSync(metadataPath)) return;
                
                try {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
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