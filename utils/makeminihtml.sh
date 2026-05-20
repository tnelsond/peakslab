#!/bin/bash

##############################################################################
# Inline HTML Processor
# Inlines external SVG, CSS, and JavaScript files into a single HTML file
##############################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print error messages
error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Function to print success messages
success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print info messages
info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Function to resolve file paths
resolve_path() {
    local file_path="$1"
    local base_dir="$2"
    
    # If it's an absolute path
    if [[ "$file_path" =~ ^/ ]]; then
        # Try relative to project root first
        if [[ -f ".${file_path}" ]]; then
            echo ".${file_path}"
        # Then try relative to base directory
        elif [[ -f "${base_dir}${file_path}" ]]; then
            echo "${base_dir}${file_path}"
        else
            echo "$file_path"
        fi
    else
        # Relative path - resolve from base directory
        echo "${base_dir}${file_path}"
    fi
}

# Check if input file is provided
if [[ $# -lt 1 ]]; then
    error "Usage: $0 <input.html> [output.html]"
fi

INPUT_FILE="$1"
OUTPUT_FILE="${2:-${INPUT_FILE%.html}.inlined.html}"
BASE_DIR="$(dirname "$INPUT_FILE")/"
TEMP_FILE=$(mktemp)

# Verify input file exists
[[ -f "$INPUT_FILE" ]] || error "Input file '$INPUT_FILE' not found"

info "Processing: $INPUT_FILE"
info "Base directory: $BASE_DIR"

# Read the input file
cat "$INPUT_FILE" > "$TEMP_FILE"

##############################################################################
# Inline CSS files
##############################################################################
info "Inlining CSS files..."

while IFS= read -r line; do
    if [[ $line =~ \<link[[:space:]]+rel=\"stylesheet\"[[:space:]]+href=\"([^\"]+)\" ]]; then
        CSS_FILE="${BASH_REMATCH[1]}"
        RESOLVED_CSS=$(resolve_path "$CSS_FILE" "$BASE_DIR")
        
        if [[ -f "$RESOLVED_CSS" ]]; then
            info "  Found CSS: $RESOLVED_CSS"
            REPLACEMENT="<style>\n$(cat "$RESOLVED_CSS")\n</style>"
            sed -i.bak "s|${line//\//\\/}|${REPLACEMENT//&/\\\&}|g" "$TEMP_FILE"
            rm -f "$TEMP_FILE.bak"
            success "  Inlined: $CSS_FILE"
        else
            error "CSS file not found: $RESOLVED_CSS (original: $CSS_FILE)"
        fi
    fi
done < "$INPUT_FILE"

##############################################################################
# Inline SVG files
##############################################################################
info "Inlining SVG files..."

while IFS= read -r line; do
    if [[ $line =~ \<img[[:space:]]+[^>]*src=\"([^\"]*\.svg)\" ]]; then
        SVG_FILE="${BASH_REMATCH[1]}"
        RESOLVED_SVG=$(resolve_path "$SVG_FILE" "$BASE_DIR")
        
        if [[ -f "$RESOLVED_SVG" ]]; then
            info "  Found SVG: $RESOLVED_SVG"
            SVG_CONTENT=$(cat "$RESOLVED_SVG")
            REPLACEMENT="${SVG_CONTENT//&/\\\&}"
            sed -i.bak "s|${line//\//\\/}|${REPLACEMENT}|g" "$TEMP_FILE"
            rm -f "$TEMP_FILE.bak"
            success "  Inlined: $SVG_FILE"
        else
            error "SVG file not found: $RESOLVED_SVG (original: $SVG_FILE)"
        fi
    fi
done < "$INPUT_FILE"

##############################################################################
# Inline JavaScript files
##############################################################################
info "Inlining JavaScript files..."

while IFS= read -r line; do
    if [[ $line =~ \<script[[:space:]]+src=\"([^\"]+)\" ]]; then
        JS_FILE="${BASH_REMATCH[1]}"
        RESOLVED_JS=$(resolve_path "$JS_FILE" "$BASE_DIR")
        
        if [[ -f "$RESOLVED_JS" ]]; then
            info "  Found JS: $RESOLVED_JS"
            REPLACEMENT="<script>\n$(cat "$RESOLVED_JS")\n</script>"
            sed -i.bak "s|${line//\//\\/}|${REPLACEMENT//&/\\\&}|g" "$TEMP_FILE"
            rm -f "$TEMP_FILE.bak"
            success "  Inlined: $JS_FILE"
        else
            error "JavaScript file not found: $RESOLVED_JS (original: $JS_FILE)"
        fi
    fi
done < "$INPUT_FILE"

##############################################################################
# Write output file
##############################################################################
mv "$TEMP_FILE" "$OUTPUT_FILE"
success "Output written to: $OUTPUT_FILE"

