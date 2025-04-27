#ifndef CONFIG_H
#define CONFIG_H

// Server configuration
#define PORT 3000
#define UPLOAD_DIR "uploads"
#define MAX_FILE_SIZE (4ULL * 1024 * 1024 * 1024) // 4GB
#define FILE_EXPIRY_DAYS 3

// File cleanup interval in seconds (86400 = 1 day)
#define CLEANUP_INTERVAL 86400

#endif // CONFIG_H
