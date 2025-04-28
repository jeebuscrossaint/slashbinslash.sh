document.addEventListener('DOMContentLoaded', () => {
        const uploadForm = document.getElementById('upload-form');
        const fileInput = document.getElementById('file-input');
        const uploadResult = document.getElementById('upload-result');
    
        uploadForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const file = fileInput.files[0];
                if (!file) {
                    uploadResult.textContent = 'Please select a file.';
                    uploadResult.style.color = '#ff3333';
                    return;
                }
            
                if (file.size > 100 * 1024 * 1024) {
                    uploadResult.textContent = 'File size exceeds 100MB limit.';
                    uploadResult.style.color = '#ff3333';
                    return;
                }
            
                const formData = new FormData();
                formData.append('file', file);
                
                // Add expiry days to the form data
                const expiryDays = document.getElementById('expiry-select').value;
                formData.append('expiryDays', expiryDays);
                
                uploadResult.textContent = 'Uploading...';
                uploadResult.style.color = '#00ff00';
            
                try {
                    const response = await fetch('/upload', {
                        method: 'POST',
                        body: formData
                    });
                
                    if (response.ok) {
                        const data = await response.json();
                        
                        const url = `${window.location.origin}/${data.url}`;
                        
                        // Generate QR code
                        const qrDiv = document.createElement('div');
                        qrDiv.className = 'qr-code';
                        
                        // Generate QR code using the qrcode-generator library
                        const typeNumber = 0; // Auto-detect size
                        const errorCorrectionLevel = 'L'; // Low
                        const qr = window.qrcode(typeNumber, errorCorrectionLevel);
                        qr.addData(url);
                        qr.make();
                        
                        // Create and style QR code image
                        const qrImage = qr.createImgTag(5); // Cellsize=5
                        
                        uploadResult.innerHTML = `
                            File uploaded successfully!<br>
                            URL: <a href="${url}" target="_blank">${url}</a> 
                            <button id="copy-button" class="copy-btn" onclick="copyToClipboard('${url}')">Copy</button><br>
                            Expires in ${data.expiryDays} days.<br>
                            <div class="qr-container">
                                <div class="qr-label">Scan QR Code:</div>
                                ${qrImage}
                            </div>
                        `;
                        uploadResult.style.color = '#00ff00';
                        fileInput.value = '';
                    } else {
                        const error = await response.text();
                        uploadResult.textContent = `Upload failed: ${error}`;
                        uploadResult.style.color = '#ff3333';
                    }
            } catch (error) {
                uploadResult.textContent = `Upload failed: ${error.message}`;
                uploadResult.style.color = '#ff3333';
            }
        });
    });

    document.getElementById('file-input').addEventListener('change', function(e) {
        const fileName = e.target.files[0] ? e.target.files[0].name : 'No file selected';
        document.getElementById('selected-file').textContent = fileName;
    });

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text)
            .then(() => {
                document.getElementById('copy-button').textContent = 'Copied!';
                setTimeout(() => {
                    document.getElementById('copy-button').textContent = 'Copy';
                }, 2000);
            })
            .catch(err => {
                console.error('Could not copy text: ', err);
            });
    }
    
    // Make sure copyToClipboard is globally accessible
    window.copyToClipboard = copyToClipboard;

    // Add this function to show file type icons
function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        
        // Define icon mapping
        const icons = {
            pdf: '📄',
            doc: '📝', docx: '📝',
            xls: '📊', xlsx: '📊',
            ppt: '📊', pptx: '📊',
            txt: '📄', md: '📄',
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️',
            mp3: '🎵', wav: '🎵', ogg: '🎵',
            mp4: '🎬', avi: '🎬', mov: '🎬', mkv: '🎬',
            zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
            html: '🌐', css: '🌐', js: '🌐',
            exe: '⚙️', dll: '⚙️',
            sh: '📜', bash: '📜'
        };
        
        return icons[ext] || '📄'; // Default icon
    }
    
    // Update the file name display to include an icon
    document.getElementById('file-input').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const icon = getFileIcon(file.name);
            document.getElementById('selected-file').textContent = `${icon} ${file.name}`;
        } else {
            document.getElementById('selected-file').textContent = 'No file selected';
        }
    });