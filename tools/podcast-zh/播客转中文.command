#!/bin/bash
# 双击运行：粘贴 Apple 播客单集链接，生成 Obsidian 中文稿。
# Resolve the real location so a shortcut (symlink) on the Desktop works too.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
PY="$HOME/Applications/Fed-English-Translator/.runtime/python/bin/python3"
if [ ! -x "$PY" ]; then
  echo "找不到 PhyrexNi 翻译工具（~/Applications/Fed-English-Translator）。"
  echo "本工具借用它的语音模型和 ChatGPT 登录，请先确认它还在原位置。"
  read -r -p "按回车关闭。" _
  exit 1
fi
echo "在 Apple 播客里打开某一集 →「分享」→「拷贝链接」，粘贴到这里后按回车："
read -r LINK
[ -z "$LINK" ] && exit 0
"$PY" -B -E -s -X utf8 podcast_zh.py "$LINK" --open
echo
read -r -p "按回车关闭这个窗口。" _
