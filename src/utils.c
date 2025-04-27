#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <ctype.h>

#include "utils.h"

// Generate a random filename
void generate_random_filename(char *buffer, size_t size) {
    static const char charset[] = "abcdefghijklmnopqrstuvwxyz0123456789";

    if (size < 9) return; // Need at least 8 chars + null terminator

    // Seed the random number generator if needed
    static int seeded = 0;
    if (!seeded) {
        srand(time(NULL));
        seeded = 1;
    }

    for (size_t i = 0; i < 8; i++) {
        int index = rand() % (sizeof(charset) - 1);
        buffer[i] = charset[index];
    }
    buffer[8] = '\0';
}

// Get the expiry date as a string
char* get_expiry_date_string(int days_from_now) {
    static char date_str[64];
    time_t now = time(NULL);
    now += days_from_now * 24 * 60 * 60; // Add days

    struct tm *tm_info = localtime(&now);
    strftime(date_str, sizeof(date_str), "%Y-%m-%d %H:%M:%S", tm_info);

    return date_str;
}

// Determine content type from filename
const char* get_content_type(const char *filename) {
    // Get file extension
    const char *ext = strrchr(filename, '.');
    if (!ext) return "application/octet-stream";

    ext++; // Skip the dot

    // Convert to lowercase for comparison
    char lower_ext[32] = {0};
    size_t i;
    for (i = 0; i < sizeof(lower_ext) - 1 && ext[i]; i++) {
        lower_ext[i] = tolower(ext[i]);
    }

    // Check common types
    if (strcmp(lower_ext, "html") == 0 || strcmp(lower_ext, "htm") == 0)
        return "text/html";
    if (strcmp(lower_ext, "css") == 0)
        return "text/css";
    if (strcmp(lower_ext, "js") == 0)
        return "application/javascript";
    if (strcmp(lower_ext, "json") == 0)
        return "application/json";
    if (strcmp(lower_ext, "txt") == 0)
        return "text/plain";
    if (strcmp(lower_ext, "jpg") == 0 || strcmp(lower_ext, "jpeg") == 0)
        return "image/jpeg";
    if (strcmp(lower_ext, "png") == 0)
        return "image/png";
    if (strcmp(lower_ext, "gif") == 0)
        return "image/gif";
    if (strcmp(lower_ext, "pdf") == 0)
        return "application/pdf";
    if (strcmp(lower_ext, "zip") == 0)
        return "application/zip";

    // Default binary type
    return "application/octet-stream";
}
