#!/bin/bash
# 安装两个 Obsidian 插件和它们用的本机工具。
# 用法：./install.sh "/你的/Obsidian/仓库路径"
set -e
VAULT="${1:?用法：./install.sh \"/你的/Obsidian/仓库路径\"}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TRANSLATOR="$HOME/Applications/Fed-English-Translator"
PT="$HOME/Applications/Podcast-ZH"
MT="$HOME/Applications/Magazine-ZH"

[ -d "$VAULT/.obsidian" ] || { echo "这不像 Obsidian 仓库（找不到 .obsidian）：$VAULT"; exit 1; }
[ -x "$TRANSLATOR/.runtime/python/bin/python3" ] || {
  echo "需要先安装 PhyrexNi 英语直播翻译工具（Mac 版）到 $TRANSLATOR，并在里面登录 ChatGPT。"
  echo "本工具借用它的 Python、语音模型和 ChatGPT 登录：https://github.com/nisen0808-web/phyrex-english-translator"
  exit 1
}

mkdir -p "$PT/bin" "$MT"
cp "$HERE/tools/podcast-zh/"{podcast_zh.py,apple_transcribe.swift,播客转中文.command,使用说明.md} "$PT/"
cp "$HERE/tools/magazine-zh/"{magazine_zh.py,test_parse.py} "$MT/"
chmod +x "$PT/播客转中文.command"
echo "$VAULT" > "$PT/vault.txt"
echo "$VAULT" > "$MT/vault.txt"

# Apple 本机语音识别（macOS 26 及以上）；编译失败时播客工具会自动改用 Whisper。
if xcrun swiftc -O -parse-as-library "$PT/apple_transcribe.swift" -o "$PT/bin/apple_transcribe" 2>/dev/null; then
  echo "已编译苹果语音识别"
else
  echo "（没能编译苹果语音识别，播客会改用 Whisper，速度慢一些）"
fi

for id in liuqing-podcast-zh liuqing-magazine-zh; do
  mkdir -p "$VAULT/.obsidian/plugins/$id"
  cp "$HERE/plugins/$id/"{manifest.json,main.js,styles.css} "$VAULT/.obsidian/plugins/$id/"
done
[ -e "$VAULT/中文稿工作台.md" ] || cp "$HERE/中文稿工作台.md" "$VAULT/"

echo
echo "安装完成。重启 Obsidian，在「设置 → 第三方插件」里打开 Liuqing Podcast 中文稿 和 Liuqing Magazine 中文稿，"
echo "然后打开仓库根目录的「中文稿工作台」。"
