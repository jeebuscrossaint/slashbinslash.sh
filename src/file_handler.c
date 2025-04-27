#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <microhttpd.h>
#include <sys/stat.h>
#include <time.h>
#include <dirent.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>

#include "file_handler.h"
#include "utils.h"
#include "config.h"
#include "html_resources.h"

// Structure for file upload state
struct FileUploadState {
    FILE *fp;
    char filename[64];
    int first_call;
};

// Serve the main HTML page
enum MHD_Result serve_main_page(struct MHD_Connection *connection) {
    struct MHD_Response *response = MHD_create_response_from_buffer(
        strlen(INDEX_HTML), (void *)INDEX_HTML, MHD_RESPMEM_PERSISTENT);

    MHD_add_response_header(response, "Content-Type", "text/html");
    enum MHD_Result ret = MHD_queue_response(connection, MHD_HTTP_OK, response);
    MHD_destroy_response(response);

    return ret;
}

// Serve CSS file
enum MHD_Result serve_css(struct MHD_Connection *connection) {
    struct MHD_Response *response = MHD_create_response_from_buffer(
        strlen(STYLE_CSS), (void *)STYLE_CSS, MHD_RESPMEM_PERSISTENT);

    MHD_add_response_header(response, "Content-Type", "text/css");
    enum MHD_Result ret = MHD_queue_response(connection, MHD_HTTP_OK, response);
    MHD_destroy_response(response);

    return ret;
}

// Serve JavaScript file
enum MHD_Result serve_js(struct MHD_Connection *connection) {
    struct MHD_Response *response = MHD_create_response_from_buffer(
        strlen(SCRIPT_JS), (void *)SCRIPT_JS, MHD_RESPMEM_PERSISTENT);

    MHD_add_response_header(response, "Content-Type", "application/javascript");
    enum MHD_Result ret = MHD_queue_response(connection, MHD_HTTP_OK, response);
    MHD_destroy_response(response);

    return ret;
}

// Handle multipart/form-data upload
enum MHD_Result handle_file_upload(struct MHD_Connection *connection,
                                 const char *upload_data,
                                 size_t *upload_data_size,
                                 void **con_cls) {
    struct FileUploadState *state;

    // First call, create upload state
    if (*con_cls == NULL) {
        state = malloc(sizeof(struct FileUploadState));
        if (state == NULL) return MHD_NO;

        // Generate random filename
        generate_random_filename(state->filename, sizeof(state->filename));

        // Create the file
        char filepath[512];
        snprintf(filepath, sizeof(filepath), "%s/%s", UPLOAD_DIR, state->filename);
        state->fp = fopen(filepath, "wb");
        if (!state->fp) {
            free(state);
            return MHD_NO;
        }

        state->first_call = 1;
        *con_cls = state;
        return MHD_YES;
    }

    state = *con_cls;

    // Handle data upload
    if (*upload_data_size != 0) {
        fwrite(upload_data, 1, *upload_data_size, state->fp);
        *upload_data_size = 0;
        return MHD_YES;
    }

    // Upload complete, prepare response
    fclose(state->fp);

    // Check if this is a curl request to format response accordingly
    const char *user_agent = MHD_lookup_connection_value(
        connection, MHD_HEADER_KIND, "User-Agent");

    char url[512];
    char host[256] = "localhost:3000"; // Default

    // Get the host header if available
    const char *host_header = MHD_lookup_connection_value(
        connection, MHD_HEADER_KIND, "Host");
    if (host_header) {
        strncpy(host, host_header, sizeof(host)-1);
    }

    snprintf(url, sizeof(url), "http://%s/%s", host, state->filename);

    struct MHD_Response *response;
    if (user_agent && strstr(user_agent, "curl")) {
        // Plain text for curl
        response = MHD_create_response_from_buffer(
            strlen(url), (void *)url, MHD_RESPMEM_MUST_COPY);
        MHD_add_response_header(response, "Content-Type", "text/plain");
    } else {
        // JSON for browsers
        char json[1024];
        snprintf(json, sizeof(json),
                 "{\"url\": \"%s\", \"filename\": \"%s\", \"size\": %ld, \"expires\": \"%s\"}",
                 url, state->filename, ftell(state->fp),
                 get_expiry_date_string(FILE_EXPIRY_DAYS));

        response = MHD_create_response_from_buffer(
            strlen(json), (void *)json, MHD_RESPMEM_MUST_COPY);
        MHD_add_response_header(response, "Content-Type", "application/json");
    }

    enum MHD_Result ret = MHD_queue_response(connection, MHD_HTTP_OK, response);
    MHD_destroy_response(response);
    free(state);
    *con_cls = NULL;

    return ret;
}

// Serve a file for download
enum MHD_Result serve_file(struct MHD_Connection *connection, const char *url) {
    // Skip the leading '/' in the URL
    const char *filename = url + 1;

    // Validate filename (basic security check)
    if (strstr(filename, "..") || strchr(filename, '/')) {
        return MHD_NO; // Possible path traversal attempt
    }

    char filepath[512];
    snprintf(filepath, sizeof(filepath), "%s/%s", UPLOAD_DIR, filename);

    // Check if file exists
    struct stat st;
    if (stat(filepath, &st) != 0) {
        const char *not_found = "File not found or expired";
        struct MHD_Response *response = MHD_create_response_from_buffer(
            strlen(not_found), (void *)not_found, MHD_RESPMEM_PERSISTENT);

        enum MHD_Result ret = MHD_queue_response(connection, MHD_HTTP_NOT_FOUND, response);
        MHD_destroy_response(response);
        return ret;
    }

    // Open file
    int fd = open(filepath, O_RDONLY);
    if (fd == -1) return MHD_NO;

    // Determine content type
    const char *content_type = get_content_type(filename);

    // Create response
    struct MHD_Response *response = MHD_create_response_from_fd(st.st_size, fd);
    MHD_add_response_header(response, "Content-Type", content_type);

    enum MHD_Result ret = MHD_queue_response(connection, MHD_HTTP_OK, response);
    MHD_destroy_response(response);

    return ret;
}

// Clean up expired files
void cleanup_expired_files(void) {
    DIR *dir;
    struct dirent *entry;
    struct stat st;
    char filepath[512];
    time_t now = time(NULL);
    time_t expiry = FILE_EXPIRY_DAYS * 24 * 60 * 60; // days to seconds

    dir = opendir(UPLOAD_DIR);
    if (dir == NULL) return;

    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue; // Skip hidden files

        snprintf(filepath, sizeof(filepath), "%s/%s", UPLOAD_DIR, entry->d_name);

        if (stat(filepath, &st) == 0) {
            if (now - st.st_mtime > expiry) {
                if (unlink(filepath) == 0) {
                    printf("Deleted expired file: %s\n", entry->d_name);
                }
            }
        }
    }

    closedir(dir);
}
