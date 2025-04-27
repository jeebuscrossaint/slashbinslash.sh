#ifndef UTILS_H
#define UTILS_H

// Generate a random filename
void generate_random_filename(char *buffer, size_t size);

// Get the expiry date as a string
char* get_expiry_date_string(int days_from_now);

// Determine content type from filename
const char* get_content_type(const char *filename);

#endif // UTILS_H
