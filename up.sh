#!/bin/bash
# slashbinslash.sh upload script with multiple file support

# Configuration - change these to match your server
SERVER="localhost:3000"
PROTOCOL="http"
DEFAULT_EXPIRY_DAYS=7

# Function to upload a single file
upload_single_file() {
    local file="$1"
    local expiry_days="${2:-$DEFAULT_EXPIRY_DAYS}"
    echo "Uploading file: $file"
    result=$(curl -s -F "file=@$file" -F "expiryDays=$expiry_days" "$PROTOCOL://$SERVER/upload")

    # Check if result is plain text (probably a URL)
    if [[ $result == http* ]]; then
        echo "$result"
        return 0
    fi

    # If not plain text, try to parse as JSON to get the fileId
    fileId=$(echo $result | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
    if [ -z "$fileId" ]; then
        fileId=$(echo $result | grep -o '"fileId":"[^"]*"' | cut -d'"' -f4)
        if [ -z "$fileId" ]; then
            echo "Upload failed or unexpected response: $result"
            return 1
        fi
    fi

    echo "$PROTOCOL://$SERVER/$fileId"
    return 0
}

# Function to upload multiple files as a collection
upload_multiple_files() {
    local files=("$@")
    local count=${#files[@]}
    local expiry_days="$DEFAULT_EXPIRY_DAYS"

    echo "Uploading $count files as collection..."

    # Extract expiry days if it's the first argument with -e prefix
    if [[ "${files[0]}" == -e* ]]; then
        expiry_days="${files[0]#-e}"
        files=("${files[@]:1}")  # Remove the first element (the expiry option)
        count=$((count-1))
    fi

    # Build curl command with multiple -F file arguments
    local curl_cmd="curl -s"
    for ((i=0; i<count; i++)); do
        file="${files[$i]}"
        curl_cmd+=" -F \"files=@$file\""
    done
    curl_cmd+=" -F \"expiryDays=$expiry_days\" \"$PROTOCOL://$SERVER/upload-multiple\""

    # Run the curl command
    result=$(eval $curl_cmd)

    # Parse the result to get collection URL
    if echo "$result" | grep -q '"collectionId"'; then
        collectionId=$(echo "$result" | grep -o '"collectionId":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$collectionId" ]; then
            echo "$PROTOCOL://$SERVER/$collectionId (Collection of $count files)"
            return 0
        fi
    elif [ "$count" -eq 1 ] && echo "$result" | grep -q '"fileId"'; then
        # Handle case where only one file was found
        fileId=$(echo "$result" | grep -o '"fileId":"[^"]*"' | head -1 | cut -d'"' -f4)
        if [ -n "$fileId" ]; then
            echo "$PROTOCOL://$SERVER/$fileId"
            return 0
        fi
    fi

    echo "Upload failed or unexpected response: $result"
    return 1
}

# Function to check if an argument is a glob pattern
is_glob_pattern() {
    [[ "$1" == *\** || "$1" == *\?* || "$1" == *\[* ]]
}

# Function to handle piped input
handle_pipe_input() {
    echo "Uploading from pipe..."
    # Create a temporary file to store the piped content
    temp_file=$(mktemp)
    cat > "$temp_file"
    upload_single_file "$temp_file"
    rm -f "$temp_file"
}

# Main script logic
if [ -t 0 ]; then
    # Input is from arguments (files), not a pipe
    if [ $# -eq 0 ]; then
        echo "Usage: $0 [options] <file(s)> or command | $0"
        echo "Options:"
        echo "  -e<days>  Set expiry days (1-14, default is 7)"
        echo "Examples:"
        echo "  $0 file.txt                  # Upload a single file"
        echo "  $0 -e14 file.txt             # Upload with 14-day expiry"
        echo "  $0 *.pdf                     # Upload multiple PDFs as collection"
        echo "  $0 -e3 file1.txt file2.jpg   # Upload collection with 3-day expiry"
        exit 1
    fi

    # Check for expiry option
    expiry_option=""
    if [[ "$1" == -e* ]]; then
        expiry_option="$1"
        shift
    fi

    # If only one file and not a glob pattern, upload as single file
    if [ $# -eq 1 ] && ! is_glob_pattern "$1" && [ -f "$1" ]; then
        if [ -n "$expiry_option" ]; then
            upload_single_file "$1" "${expiry_option#-e}"
        else
            upload_single_file "$1"
        fi
    else
        # Multiple files or glob pattern - collect all matching files
        files=()
        for pattern in "$@"; do
            # Check if this is a glob pattern that needs expansion
            if is_glob_pattern "$pattern"; then
                # Expand the glob pattern and add matching files
                for file in $pattern; do
                    if [ -f "$file" ]; then
                        files+=("$file")
                    fi
                done
            elif [ -f "$pattern" ]; then
                # Add the individual file
                files+=("$pattern")
            else
                echo "Warning: '$pattern' is not a valid file, skipping."
            fi
        done

        # Check if we found any files
        if [ ${#files[@]} -eq 0 ]; then
            echo "No valid files found to upload."
            exit 1
        fi

        # Upload the collection
        if [ -n "$expiry_option" ]; then
            upload_multiple_files "$expiry_option" "${files[@]}"
        else
            upload_multiple_files "${files[@]}"
        fi
    fi
else
    # Input is from a pipe
    handle_pipe_input
fi
