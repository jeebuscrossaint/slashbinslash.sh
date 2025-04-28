const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

const NC_PORT = 9999; // Port for netcat listener same one as termbin for all the termbinners out there

// Update the netcat server implementation
const ncServer = net.createServer((socket) => {
        let data = Buffer.from('');
        let receivedData = false;
        const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        
        console.log(`New netcat connection from ${clientAddress}`);
        
        // Increase timeout to 10 seconds for slower connections
        socket.setTimeout(10000);
        socket.on('timeout', () => {
            console.log(`Netcat connection from ${clientAddress} timed out`);
            if (receivedData) {
                processUpload();
            } else {
                socket.end('Error: No data received\n');
            }
            socket.destroy();
        });
        
        socket.on('data', (chunk) => {
            // Log when we receive data and its size
            console.log(`Received ${chunk.length} bytes from ${clientAddress}`);
            
            // Append incoming data chunks
            data = Buffer.concat([data, chunk]);
            receivedData = true;
            
            // Limit size to prevent abuse (10MB max)
            if (data.length > 10 * 1024 * 1024) {
                socket.end('Error: Data too large\n');
                socket.destroy();
                return;
            }
            
            // Try to detect end of transmission for clients that don't properly close
            if (chunk.includes(0x04) || chunk.includes(0x1A)) {  // EOT or SUB characters
                console.log(`EOT/SUB detected from ${clientAddress}, processing upload`);
                processUpload();
            }
        });
        
        socket.on('end', () => {
            console.log(`Connection ended from ${clientAddress}`);
            if (receivedData) {
                processUpload();
            }
        });
        
        socket.on('error', (err) => {
            console.error(`Socket error from ${clientAddress}:`, err);
            socket.destroy();
        });
        
        // Extract upload logic to a function to avoid duplication
        function processUpload() {
            // Only process once
            if (!receivedData) return;
            receivedData = false;
            
            try {
                // Generate a random file ID
                const fileId = crypto.randomBytes(4).toString('hex');
                
                // Create a dedicated directory for this upload
                const uploadDir = path.join(uploadsDir, fileId);
                fs.mkdirSync(uploadDir, { recursive: true });
                
                // Create a timestamp for the filename
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const fileName = `nc-${timestamp}.txt`;
                
                // Store metadata
                const fileInfo = {
                    originalName: fileName,
                    uploadDate: new Date().toISOString(),
                    expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
                };
                
                // Save file metadata
                fs.writeFileSync(
                    path.join(uploadDir, 'metadata.json'),
                    JSON.stringify(fileInfo)
                );
                
                // Save the data as a text file
                fs.writeFileSync(
                    path.join(uploadDir, fileName), 
                    data
                );
                
                // Return the URL to the client
                const url = `${fileId}/${encodeURIComponent(fileName)}`;
                // Use protocol and host from settings, fallback to localhost
                const fullUrl = `http://${process.env.HOST || 'localhost'}:${PORT}/${url}`;
                
                socket.write(`${fullUrl}\n`);
                socket.end();
                
                console.log(`Netcat upload successful: ${fullUrl}`);
            } catch (err) {
                console.error('Error processing netcat upload:', err);
                socket.write('Error during upload\n');
                socket.end();
            }
        }
    });

    ncServer.listen(NC_PORT, () => {
        console.log(`Netcat server listening on port ${NC_PORT}`);
    });
    
    // Handle errors
    ncServer.on('error', (err) => {
        console.error('Netcat server error:', err);
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
            
            // Check if request is from curl (or similar CLI tool)
            const userAgent = req.get('User-Agent') || '';
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
        const metadataPath = path.join(uploadDir, 'metadata.json');
        
        if (fs.existsSync(metadataPath)) {
            // This is a new-style upload with a directory
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            // Redirect to the full URL with filename
            return res.redirect(`/${fileId}/${encodeURIComponent(metadata.originalName)}`);
        } else {
            // This might be an old-style upload or non-existent
            return res.status(404).send('File not found or has expired.');
        }
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