#!/bin/bash
# slashbinslash.sh upload script

if [ -t 0 ]; then
    # If input is from a file
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <file> or command | $0"
        exit 1
    fi
    
    if [ ! -f "$1" ]; then
        echo "Error: File not found."
        exit 1
    fi
    
    echo "Uploading file: $1"
    result=$(curl -s -F "file=@$1" https://slashbinslash.sh/upload)
else
    # If input is from a pipe
    echo "Uploading from pipe..."
    result=$(curl -s -F "file=@-" https://slashbinslash.sh/upload)
fi

# Parse the JSON to get the fileId
fileId=$(echo $result | grep -o '"fileId":"[^"]*"' | cut -d'"' -f4)
if [ -z "$fileId" ]; then
    echo "Upload failed: $result"
    exit 1
fi

echo "https://slashbinslash.sh/$fileId"