#!/bin/bash
# slashbinslash.sh upload script
#
# You can also use netcat:
# echo "hello world" | nc slashbinslash.sh 9999
# cat file.txt | nc slashbinslash.sh 9999

if [ -t 0 ]; then
    # If input is from a file
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <file> or command | $0"
        echo "       You can also use: command | nc slashbinslash.sh 9999"
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

echo "$result"