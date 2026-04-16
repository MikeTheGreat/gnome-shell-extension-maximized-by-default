#!/bin/bash

# --- CONFIGURATION ---
SRC_DIR="src"
BUILD_DIR="dist"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"

# Check if src folder exists
if [ ! -d "$SRC_DIR" ]; then
    echo "❌ Error: '$SRC_DIR' directory not found. Are you in the project root?"
    exit 1
fi

# 1️⃣ Extract UUID (Automatic)
# Reads metadata.json inside src to find the unique ID
UUID=$(grep -oP '(?<="uuid": ")[^"]*' "$SRC_DIR/metadata.json")

if [ -z "$UUID" ]; then
    echo "❌ Error: Could not find UUID in $SRC_DIR/metadata.json"
    exit 1
fi

echo "🔍 Found extension: $UUID"

# 2️⃣ BUILD Phase (Compile schemas + Create Zip)
echo "🔧 Compiling GSettings schemas..."
glib-compile-schemas "$SRC_DIR/schemas/"

echo "📦 Creating package in $BUILD_DIR..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
(cd "$SRC_DIR" && zip -q -r9 "../$BUILD_DIR/gnome-shell-extension-maximized-by-default.zip" .)

# 3️⃣ INSTALL Phase (Direct Copy)
echo "🚀 Installing..."

# Remove old version if it exists
if [ -d "$EXT_DIR/$UUID" ]; then
    rm -rf "$EXT_DIR/$UUID"
fi

# Create directory and copy source files
mkdir -p "$EXT_DIR/$UUID"
cp -r "$SRC_DIR"/* "$EXT_DIR/$UUID/"

echo "✅ Done! Extension installed and packaged."
echo "🔄 Now Log Out/Log In or (on X11) press Alt+F2, type 'r', and hit Enter."