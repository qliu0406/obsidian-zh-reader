#!/bin/bash
# Build both plugins' main.js: 'use strict' + the plugin's imports + the shared ChatGPT account code + the plugin body.
# The plugins have no npm dependencies and no bundler; edit the files in this folder, then run ./build.sh.
set -e
cd "$(dirname "$0")"
build() {
  local body="$1" out="$2"
  { echo "'use strict';"; sed -n '1,/^const { Plugin/p' "$body"; echo; cat account.js; echo; sed '1,/^const { Plugin/d' "$body"; } > "$out"
  node --check "$out"
}
build podcast.plugin.js ../liuqing-podcast-zh/main.js
build magazine.plugin.js ../liuqing-magazine-zh/main.js
echo "built plugins/liuqing-podcast-zh/main.js and plugins/liuqing-magazine-zh/main.js"
