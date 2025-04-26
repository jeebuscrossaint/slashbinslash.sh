document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("upload-form");
  const resultDiv = document.getElementById("result");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById("file");
    if (!fileInput.files.length) {
      showResult("Please select a file", "error");
      return;
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    try {
      showResult("Uploading...", "info");

      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${await response.text()}`,
        );
      }

      const data = await response.json();

      // Display success message with the file URL
      showResult(
        `
                <p>File uploaded successfully!</p>
                <p>URL: <a href="${data.url}" target="_blank" class="file-url">${data.url}</a></p>
                <p>Size: ${formatFileSize(data.size)}</p>
                <p>Expires: ${new Date(data.expires).toLocaleString()}</p>
            `,
        "success",
      );

      // Clear the file input
      fileInput.value = "";
    } catch (error) {
      showResult(`Upload failed: ${error.message}`, "error");
    }
  });

  function showResult(message, type) {
    resultDiv.innerHTML = message;
    resultDiv.className = type; // Set class based on message type
    resultDiv.classList.remove("hidden");
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " bytes";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    else return (bytes / 1073741824).toFixed(1) + " GB";
  }
});
