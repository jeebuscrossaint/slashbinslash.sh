#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <microhttpd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <errno.h>

#include "file_handler.h"
#include "config.h"
#include "html_resources.h"

struct MHD_Daemon *daemon;

// Handle HTTP requests
static enum MHD_Result handle_request(void *cls, struct MHD_Connection *connection,
                                    const char *url, const char *method,
                                    const char *version, const char *upload_data,
                                    size_t *upload_data_size, void **con_cls) {

    // Serve the main page
    if (strcmp(url, "/") == 0) {
        return serve_main_page(connection);
    }

    // Handle style.css request
    if (strcmp(url, "/style.css") == 0) {
        return serve_css(connection);
    }

    // Handle script.js request
    if (strcmp(url, "/script.js") == 0) {
        return serve_js(connection);
    }

    // Handle file upload
    if (strcmp(url, "/upload") == 0 && strcmp(method, "POST") == 0) {
        return handle_file_upload(connection, upload_data, upload_data_size, con_cls);
    }

    // Handle file download (anything else is considered a file request)
    return serve_file(connection, url);
}

int main() {
    // Create uploads directory if it doesn't exist
    mkdir(UPLOAD_DIR, 0755);

    // Start the HTTP server
    daemon = MHD_start_daemon(MHD_USE_INTERNAL_POLLING_THREAD, PORT, NULL, NULL,
                             &handle_request, NULL, MHD_OPTION_END);

    if (daemon == NULL) {
        fprintf(stderr, "Failed to start server\n");
        return 1;
    }

    printf("slashbinslash.sh server running on port %d\n", PORT);
    printf("Files will expire after %d days\n", FILE_EXPIRY_DAYS);
    printf("Maximum file size: %luGB\n", MAX_FILE_SIZE / (1024 * 1024 * 1024));

    // Keep the server running
    getchar();

    // Cleanup
    MHD_stop_daemon(daemon);

    return 0;
}
