#ifndef FILE_HANDLER_H
#define FILE_HANDLER_H

#include <microhttpd.h>

// Serve the main HTML page
enum MHD_Result serve_main_page(struct MHD_Connection *connection);

// Serve CSS file
enum MHD_Result serve_css(struct MHD_Connection *connection);

// Serve JavaScript file
enum MHD_Result serve_js(struct MHD_Connection *connection);

// Handle file upload
enum MHD_Result handle_file_upload(struct MHD_Connection *connection,
                                  const char *upload_data,
                                  size_t *upload_data_size,
                                  void **con_cls);

// Serve a file for download
enum MHD_Result serve_file(struct MHD_Connection *connection, const char *url);

// Clean up expired files
void cleanup_expired_files(void);

#endif // FILE_HANDLER_H
