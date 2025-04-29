document.addEventListener("DOMContentLoaded", () => {
  const uploadForm = document.getElementById("upload-form");
  const fileInput = document.getElementById("file-input");
  const uploadResult = document.getElementById("upload-result");
  const selectedFileDisplay = document.getElementById("selected-file");

  // Update the file selection display for multiple files
  fileInput.addEventListener("change", function (e) {
    if (this.files.length === 0) {
      selectedFileDisplay.textContent = "No files selected";
    } else if (this.files.length === 1) {
      const file = this.files[0];
      const icon = getFileIcon(file.name);
      selectedFileDisplay.textContent = `${icon} ${file.name}`;
    } else {
      selectedFileDisplay.textContent = `${this.files.length} files selected`;

      // Create a list of selected files
      const fileList = document.createElement("ul");
      fileList.className = "selected-files-list";

      Array.from(this.files).forEach((file) => {
        const icon = getFileIcon(file.name);
        const item = document.createElement("li");
        item.textContent = `${icon} ${file.name}`;
        fileList.appendChild(item);
      });

      selectedFileDisplay.innerHTML = "";
      selectedFileDisplay.appendChild(fileList);
    }
  });

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const files = fileInput.files;
    if (files.length === 0) {
      uploadResult.textContent = "Please select at least one file.";
      uploadResult.style.color = "#ff3333";
      return;
    }

    // Check if total size exceeds limit
    let totalSize = 0;
    for (let i = 0; i < files.length; i++) {
      totalSize += files[i].size;
    }

    if (totalSize > 100 * 1024 * 1024) {
      uploadResult.textContent = "Total file size exceeds 100MB limit.";
      uploadResult.style.color = "#ff3333";
      return;
    }

    const formData = new FormData();

    // Append all files - using "file" as the field name for consistency
    for (let i = 0; i < files.length; i++) {
      formData.append("file", files[i]);
    }

    // Add expiry days to the form data
    const expiryDays = document.getElementById("expiry-select").value;
    formData.append("expiryDays", expiryDays);

    uploadResult.textContent = "Uploading...";
    uploadResult.style.color = "#00ff00";

    try {
      // Use the correct endpoint based on number of files
      const endpoint = files.length > 1 ? "/upload-multiple" : "/upload";

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();

        if (data.files && data.files.length === 1) {
          // Single file handling
          const url = `${window.location.origin}/${data.files[0].url}`;

          // Generate QR code
          const qr = window.qrcode(0, "L");
          qr.addData(url);
          qr.make();
          const qrImage = qr.createImgTag(5);

          uploadResult.innerHTML = `
                            File uploaded successfully!<br>
                            URL: <a href="${url}" target="_blank">${url}</a>
                            <button class="copy-btn" onclick="copyToClipboard('${url}')">Copy</button><br>
                            Expires in ${data.expiryDays} days.<br>
                            <div class="qr-container">
                                <div class="qr-label">Scan QR Code:</div>
                                ${qrImage}
                            </div>
                        `;
        } else {
          // Multiple files handling
          const collectionUrl = `${window.location.origin}/${data.collectionId}`;

          // Generate QR code for the collection
          const qr = window.qrcode(0, "L");
          qr.addData(collectionUrl);
          qr.make();
          const qrImage = qr.createImgTag(5);

          let filesList = '<ul class="uploaded-files-list">';
          data.files.forEach((file) => {
            const fileUrl = `${window.location.origin}/${file.url}`;
            filesList += `
                                <li>
                                    ${getFileIcon(file.name)} ${file.name}
                                    <a href="${fileUrl}" target="_blank">${fileUrl}</a>
                                    <button class="copy-btn small" onclick="copyToClipboard('${fileUrl}')">Copy</button>
                                </li>`;
          });
          filesList += "</ul>";

          uploadResult.innerHTML = `
                            ${data.files.length} files uploaded successfully!<br>
                            Collection URL: <a href="${collectionUrl}" target="_blank">${collectionUrl}</a>
                            <button class="copy-btn" onclick="copyToClipboard('${collectionUrl}')">Copy</button><br>
                            Expires in ${data.expiryDays} days.<br>
                            ${filesList}
                            <div class="qr-container">
                                <div class="qr-label">Scan QR Code for Collection:</div>
                                ${qrImage}
                            </div>
                        `;
        }

        uploadResult.style.color = "#00ff00";
        fileInput.value = "";
        selectedFileDisplay.textContent = "No files selected";
      } else {
        const error = await response.text();
        uploadResult.textContent = `Upload failed: ${error}`;
        uploadResult.style.color = "#ff3333";
      }
    } catch (error) {
      uploadResult.textContent = `Upload failed: ${error.message}`;
      uploadResult.style.color = "#ff3333";
    }
  });
});

// Add this function to show file type icons
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

// Make sure copyToClipboard is globally accessible
window.copyToClipboard = function (text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const copyBtn = event.target;
      const originalText = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    })
    .catch((err) => {
      console.error("Could not copy text: ", err);
    });
};
