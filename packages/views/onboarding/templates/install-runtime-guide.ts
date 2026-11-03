/** Localized instructions for connecting an agent runtime. */
export const INSTALL_RUNTIME_GUIDE_TITLE = {
  en: "Connect a runtime to start with Mika",
  zh: "连接运行时，和 Mika 开始",
  ko: "runtime을 연결하고 Mika와 시작하기",
  ja: "runtime を接続して Mika と始める",
} as const;

const en = `Welcome to Auro.

Agents need a runtime before they can execute work.

## Install your first agent runtime

Full guide: https://auro.ai/docs/install-agent-runtime

For English users, the fastest first path is Codex:

1. Make sure Node.js is installed.
2. Install Codex:
   npm i -g @openai/codex
3. Sign in:
   codex
4. Confirm your terminal can find it:
   which codex
   codex --version
5. Wait for Auro to pick it up. A running daemon re-checks for newly
   installed CLIs every couple of minutes, so no restart is normally needed.
   To apply it immediately:
   auro daemon restart
   In the desktop app, open any local runtime and click Restart. Quitting and
   reopening the app is NOT enough — the daemon keeps running in the background.
6. Return to Runtimes and refresh. You should see a Codex runtime online.
7. Open Runtimes. The page will offer **Start with Mika**; use it to create Mika and open the guided first chat.

Codex reference: https://developers.openai.com/codex/cli

You can then open a chat with an agent to begin working.`;

const zh = `欢迎来到 Auro。

智能体需要先连接运行时才能执行工作。

## 安装第一个 Agent 运行时

完整文档:https://auro.ai/docs/install-agent-runtime

中文用户建议先装 Kimi CLI:

1. 在 macOS / Linux 终端安装 Kimi CLI:
   curl -LsSf https://code.kimi.com/install.sh | bash
   Windows PowerShell:
   Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression
2. 确认终端能找到 Kimi:
   kimi --version
3. 在你想让 Kimi 工作的项目目录里启动一次:
   kimi
4. 首次启动后输入 /login,按提示完成 Kimi Code 或 API key 配置。
5. 等 Auro 识别到它。运行中的守护进程每隔几分钟会重新检查一次新装的 CLI,通常不需要重启。
   想立刻生效:
   auro daemon restart
   桌面端请打开任意一个本机 runtime 并点 Restart。退出再打开 app 是不够的 —— 守护进程会继续在后台运行。
6. 回到 Runtimes 页面刷新。你应该能看到一个在线的 Kimi 运行时。
7. 打开"运行时"页面。页面会显示 **和 Mika 开始**；点击后会创建 Mika，并进入引导式的首次对话。

Kimi CLI 官方文档:https://moonshotai.github.io/kimi-cli/zh/guides/getting-started.html

连接后，即可与智能体聊天并开始工作。`;

const ko = `Auro에 오신 것을 환영합니다.

에이전트가 작업을 실행하려면 먼저 런타임을 연결해야 합니다.

## 첫 agent runtime 설치하기

전체 가이드: https://auro.ai/docs/install-agent-runtime

한국어 사용자는 Codex로 시작하는 것이 가장 빠릅니다:

1. Node.js가 설치되어 있는지 확인합니다.
2. Codex를 설치합니다:
   npm i -g @openai/codex
3. 로그인합니다:
   codex
4. 터미널에서 찾을 수 있는지 확인합니다:
   which codex
   codex --version
5. Auro가 인식할 때까지 기다립니다. 실행 중인 daemon은 몇 분마다 새로 설치된 CLI를
   다시 확인하므로 보통 재시작이 필요하지 않습니다.
   바로 적용하려면:
   auro daemon restart
   데스크톱 앱에서는 아무 로컬 runtime을 열고 Restart를 누르세요. 앱을 종료하고 다시 여는
   것만으로는 충분하지 않습니다 — daemon은 백그라운드에서 계속 실행됩니다.
6. Runtimes로 돌아가 새로고침합니다. Codex runtime이 online으로 보여야 합니다.
7. Runtimes를 엽니다. **Mika와 시작**을 눌러 Mika를 만들고 안내되는 첫 채팅을 시작합니다.

Codex 참고 문서: https://developers.openai.com/codex/cli

연결한 뒤 에이전트와 채팅을 시작할 수 있습니다.`;

const ja = `Auro へようこそ。

エージェントが作業を実行するには、まずランタイムを接続します。

## 最初の agent runtime をインストールする

詳しいガイド: https://auro.ai/docs/install-agent-runtime

日本語ユーザーには、Codex で始めるのが最も速い経路です:

1. Node.js がインストールされていることを確認します。
2. Codex をインストールします:
   npm i -g @openai/codex
3. サインインします:
   codex
4. ターミナルから見つけられるか確認します:
   which codex
   codex --version
5. Auro が認識するまで待ちます。動作中の daemon は数分ごとに新しくインストールされた
   CLI を再チェックするため、通常は再起動は不要です。
   すぐに反映したい場合:
   auro daemon restart
   デスクトップアプリではローカル runtime を開いて Restart を押してください。アプリを終了して
   開き直すだけでは不十分です — daemon はバックグラウンドで動き続けます。
6. Runtimes に戻って再読み込みします。Codex runtime が online と表示されるはずです。
7. Runtimes を開き、**Mika と始める**を選びます。Mika が作成され、案内付きの最初のチャットが開きます。

Codex のリファレンス: https://developers.openai.com/codex/cli

接続後はエージェントとのチャットから作業を始められます。`;

export const INSTALL_RUNTIME_GUIDE_BODY = { en, zh, ko, ja } as const;
