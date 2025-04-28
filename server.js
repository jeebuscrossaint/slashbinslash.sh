const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configure file storage
const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            // Generate a random file ID
            const fileId = crypto.randomBytes(4).toString('hex');
            
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
            
            // The directory name is our fileId
            const fileId = path.basename(path.dirname(req.file.path));
            const originalName = req.file.originalname;
            
            return res.status(200).json({
                fileId: fileId,
                fileName: originalName,
                url: `${fileId}/${encodeURIComponent(originalName)}`,
                message: 'File uploaded successfully.'
            });
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