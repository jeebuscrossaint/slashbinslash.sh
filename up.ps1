# slashbinslash.sh PowerShell upload script (up.ps1) with multiple file support

# Configuration - change these to match your server
$SERVER = "localhost:3000"
$PROTOCOL = "http"
$DEFAULT_EXPIRY_DAYS = 7

function Upload-SingleFile {
    param (
        [string]$FilePath,
        [int]$ExpiryDays = $DEFAULT_EXPIRY_DAYS
    )

    Write-Host "Uploading file: $FilePath"

    # Use curl.exe for consistency with the bash version
    $result = (curl.exe -s -F "file=@$FilePath" -F "expiryDays=$ExpiryDays" "$PROTOCOL`://$SERVER/upload") | Out-String

    return Process-Result $result
}

function Upload-MultipleFiles {
    param (
        [string[]]$FilePaths,
        [int]$ExpiryDays = $DEFAULT_EXPIRY_DAYS
    )

    $fileCount = $FilePaths.Count
    Write-Host "Uploading $fileCount files as collection..."

    # Build curl command with multiple -F files arguments
    $curlArgs = @("-s")
    foreach ($file in $FilePaths) {
        $curlArgs += "-F"
        $curlArgs += "files=@`"$file`""
    }

    $curlArgs += "-F"
    $curlArgs += "expiryDays=$ExpiryDays"
    $curlArgs += "$PROTOCOL`://$SERVER/upload-multiple"

    # Execute the curl command
    $result = (& curl.exe $curlArgs) | Out-String

    # Parse the result to get collection URL
    if ($result -match '"collectionId":"([^"]+)"') {
        $collectionId = $matches[1]
        return "$PROTOCOL`://$SERVER/$collectionId (Collection of $fileCount files)"
    }
    elseif ($fileCount -eq 1 -and $result -match '"fileId":"([^"]+)"') {
        # Handle case where only one file was found
        $fileId = $matches[1]
        return "$PROTOCOL`://$SERVER/$fileId"
    }
    else {
        Write-Error "Upload failed or unexpected response: $result"
        return $null
    }
}

function Upload-Pipe {
    param (
        [int]$ExpiryDays = $DEFAULT_EXPIRY_DAYS
    )

    Write-Host "Uploading from pipe..."

    # Create a temporary file to store the piped content
    $tempFile = [System.IO.Path]::GetTempFileName()

    try {
        # Read from standard input and write to the temp file
        $input | Out-File -FilePath $tempFile -Encoding ascii

        # Upload the temp file
        $result = (curl.exe -s -F "file=@$tempFile" -F "expiryDays=$ExpiryDays" "$PROTOCOL`://$SERVER/upload") | Out-String

        return Process-Result $result
    }
    finally {
        # Clean up the temp file
        if (Test-Path $tempFile) {
            Remove-Item -Path $tempFile -Force
        }
    }
}

function Process-Result {
    param (
        [string]$result
    )

    # Check if result is plain text (probably a URL)
    if ($result -match "^http") {
        return $result.Trim()
    }

    # If not plain text, try to parse as JSON to get the fileId
    if ($result -match '"url":"([^"]+)"') {
        $fileId = $matches[1]
        return "$PROTOCOL`://$SERVER/$fileId"
    }
    elseif ($result -match '"fileId":"([^"]+)"') {
        # Alternative way to get fileId
        $fileId = $matches[1]
        return "$PROTOCOL`://$SERVER/$fileId"
    }
    else {
        Write-Error "Upload failed or unexpected response: $result"
        return $null
    }
}

function Resolve-WildcardPaths {
    param (
        [string[]]$Paths
    )

    $resolvedFiles = @()

    foreach ($path in $Paths) {
        # Check if the path contains wildcards
        if ($path -match '\*' -or $path -match '\?') {
            # Resolve the wildcard path to actual files
            $matchingFiles = Get-ChildItem -Path $path -File -ErrorAction SilentlyContinue
            if ($matchingFiles) {
                $resolvedFiles += $matchingFiles.FullName
            }
            else {
                Write-Warning "No files found matching pattern: $path"
            }
        }
        elseif (Test-Path -Path $path -PathType Leaf) {
            # It's a direct file path
            $resolvedFiles += (Resolve-Path $path).Path
        }
        else {
            Write-Warning "File not found: $path"
        }
    }

    return $resolvedFiles
}

# Main execution flow
[int]$expiryDays = $DEFAULT_EXPIRY_DAYS

# Check if we have arguments and not reading from a pipe
if ($args.Count -gt 0 -and -not [Console]::IsInputRedirected) {
    # Check if the first argument is an expiry option
    if ($args[0] -match '^-e(\d+)$') {
        $expiryDays = [int]$matches[1]
        # Validate expiry days (1-14)
        if ($expiryDays -lt 1 -or $expiryDays -gt 14) {
            $expiryDays = $DEFAULT_EXPIRY_DAYS
            Write-Warning "Invalid expiry days. Using default: $DEFAULT_EXPIRY_DAYS days"
        }
        $filePaths = $args[1..($args.Count-1)]
    }
    else {
        $filePaths = $args
    }

    # Resolve all file paths including wildcards
    $files = Resolve-WildcardPaths -Paths $filePaths

    if ($files.Count -eq 0) {
        Write-Error "No valid files found to upload."
        exit 1
    }
    elseif ($files.Count -eq 1) {
        # Single file upload
        $result = Upload-SingleFile -FilePath $files[0] -ExpiryDays $expiryDays
        if ($result) {
            Write-Output $result
        }
    }
    else {
        # Multiple file upload
        $result = Upload-MultipleFiles -FilePaths $files -ExpiryDays $expiryDays
        if ($result) {
            Write-Output $result
        }
    }
}
elseif ([Console]::IsInputRedirected) {
    # Handle input from a pipe
    $result = Upload-Pipe -ExpiryDays $expiryDays
    if ($result) {
        Write-Output $result
    }
}
else {
    # Show usage information
    Write-Host "Usage:"
    Write-Host "  .\up.ps1 [options] <file(s)> or command | .\up.ps1"
    Write-Host "Options:"
    Write-Host "  -e<days>  Set expiry days (1-14, default is 7)"
    Write-Host "Examples:"
    Write-Host "  .\up.ps1 file.txt                    # Upload a single file"
    Write-Host "  .\up.ps1 -e14 file.txt               # Upload with 14-day expiry"
    Write-Host "  .\up.ps1 C:\folder\*.pdf             # Upload multiple PDFs as collection"
    Write-Host "  .\up.ps1 -e3 file1.txt file2.jpg     # Upload collection with 3-day expiry"
    exit 1
}
