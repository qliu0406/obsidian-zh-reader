# obsidian-zh-reader

在 Obsidian 里把**英文播客**和**英文杂志 / 书（EPUB）**变成中文稿，用你自己的 ChatGPT 账号翻译。

两个桌面插件 + 两个本机小工具：

| | 播客 → 中文稿 | 杂志 / 书 → 中文稿 |
|---|---|---|
| 输入 | Apple 播客单集链接 | Apple 图书（iCloud）或「下载」里的 EPUB，也可以拖放任意 EPUB |
| 英文从哪来 | 下载公开音频，用苹果本机语音识别转写（不可用时改用 Whisper） | 直接读 EPUB 正文 |
| 输出 | 一篇笔记：要点、人名术语对照、每段中文 + 可展开原文，广告自动折叠 | 先出中文目录（每篇中文标题 + 一句话简介），再按需翻译；每篇一篇笔记，**保持原文排版：英文段落下面接中文，图片留在原位** |

## 翻译质量与额度

- 默认「日常 · 省额度」：用 **GPT-5.6-Sol** 翻译；**数据和金融类文章**（Finance & economics、Business 等栏目，或标题、正文里数字和金额密集的文章）起步高一级，用 GPT-6-Sol。
- 模型要逐段标注「有没有把握」（专有名词的规范译法、术语、双关、含义不确定）。只有没把握的段落、或没通过质量检查的段落，才逐级交给更好的模型校对改正：GPT-6-Sol → GPT-6.1-Sol → GPT-6-Astra。不会整篇重翻，省额度。
- 质量检查：没翻成中文、夹杂整句英文、明显比原文短（可能漏译）都会升级校对；用最好的模型校对后仍不合格的段落会让该篇失败，同一批里有 3 篇失败就停止。
- ChatGPT 账号的 Codex 用量到上限时**立即停止**并提示恢复时间；已完成的部分都会保存，之后再运行会接着做。
- 一期杂志共用一份术语表，全刊译名一致；经济、金融、政治术语使用中国大陆规范译法（参照《经济学人》中文版、新华社译名）。
- 只翻译英文 EPUB，中文书会自动跳过；有 DRM 的书（图书商店购买）读不到正文，会直接提示。
- 也可以在插件里选择全程使用 GPT-6.1-Sol 或 GPT-6-Astra。

## 使用

1. 在 Obsidian 打开仓库根目录的 **「中文稿工作台」**：
   - **ChatGPT 账号**：显示当前登录的账号，未登录时一键打开 OpenAI 官方登录页。
   - **播客**：粘贴 Apple 播客单集链接（播客 App → 分享 → 拷贝链接），点「开始」。
   - **杂志 / 书**：列出 Apple 图书和「下载」里的 EPUB，点一本 → 生成中文目录 → 勾选文章或章节 → 「翻译选中」。
2. **自动翻译**：把英文杂志或书放进 Apple 图书（iCloud），或用隔空投送发到这台 Mac，插件会自动生成中文目录并**翻译全文**，完成后弹出提醒，直接阅读即可。中文书一律跳过（看语言标记、书名和正文）。
   - Obsidian 开着（后台也行）、Mac 醒着时，每 10 分钟检查一次；一次处理一本，按加入的先后顺序。只处理启用插件之后新加入的。
   - ChatGPT 额度用完：按 OpenAI 给的恢复时间等，到点后自动接着翻；合盖断网等造成的缺漏会在下一轮补上；同一本多次失败会停下并提醒。
   - 在工作台的杂志面板里可以关掉「新加入的 EPUB 自动翻译全文」。
3. 也可以用左侧栏的 🎙 / 📰 图标，或命令面板（⌘P）里的「中文稿」命令。

## 安装

需要：macOS（苹果芯片），Obsidian 桌面版，以及
[PhyrexNi 英语直播翻译工具](https://github.com/nisen0808-web/phyrex-english-translator) 的 Mac 版装在 `~/Applications/Fed-English-Translator`，并在其中登录过 ChatGPT。本项目借用它自带的 Python、Whisper 语音模型和 ChatGPT（Codex）登录；Codex 优先用 Codex App 自带的最新版本（新模型需要新版本）。

```bash
git clone https://github.com/qliu0406/obsidian-zh-reader.git
cd obsidian-zh-reader
./install.sh "/你的/Obsidian/仓库路径"
```

然后重启 Obsidian，在「设置 → 第三方插件」里启用 **Liuqing Podcast 中文稿** 和 **Liuqing Magazine 中文稿**。

## 目录

```
plugins/liuqing-podcast-zh/    播客插件（可直接放进 .obsidian/plugins）
plugins/liuqing-magazine-zh/   杂志 / 书插件
plugins/src/                   插件源码；改完运行 ./build.sh 生成 main.js（无 npm 依赖）
tools/podcast-zh/              podcast_zh.py、苹果语音识别（Swift）、双击启动脚本
tools/magazine-zh/             magazine_zh.py（books / status / import / translate）、EPUB 解析测试
tests/                         node tests/*.test.js（加 --real 会真实调用工具和 ChatGPT）
install.sh                     安装到 ~/Applications 和你的仓库
```

命令行也能用，例如：

```bash
~/Applications/Fed-English-Translator/.runtime/python/bin/python3 ~/Applications/Magazine-ZH/magazine_zh.py books
~/Applications/Fed-English-Translator/.runtime/python/bin/python3 ~/Applications/Magazine-ZH/magazine_zh.py translate "某期.epub" --ids 1-10
```

## 说明

- 翻译会消耗你自己 ChatGPT 账号的 Codex 额度。一期《经济学人》约 7 万词，全文翻译约 80 次请求。
- 生成的中文稿只保存在你自己的仓库里。请只翻译你有权阅读的内容；本仓库不包含任何杂志、书籍或播客内容。
- 付费 / 订阅专属的播客单集没有公开音频，无法处理。
