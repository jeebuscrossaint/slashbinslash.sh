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
            
            uploadResult.textContent = 'Uploading...';
            uploadResult.style.color = '#33ff33';
    
            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                        const data = await response.json();
                        
                        // Use the full URL with fileId/filename structure that the server provides
                        const url = `${window.location.origin}/${data.url}`;
                        
                        uploadResult.innerHTML = `
                            File uploaded successfully!<br>
                            URL: <a href="${url}" target="_blank">${url}</a><br>
                            Expires in 7 days.
                        `;
                        uploadResult.style.color = '#33ff33';
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