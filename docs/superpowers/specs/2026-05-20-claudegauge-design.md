# ClaudeGauge — Windows 桌面用量儀表板

**設計日期**：2026-05-20
**目標平台**：Windows 11（主要）、Windows 10（次要）
**狀態**：規格已批准，待實作規劃

---

## 1. 專案目的

讓使用 Claude Code 與 OpenAI Codex（訂閱制）的開發者在 Windows 桌面上隨時看到雙服務的即時用量、rate limit 餘額、與歷史統計，避免在工作高峰期意外撞限。

**核心問題**：
- Claude Code 的 statusline 只在終端機內可見，離開終端就看不到。
- Codex Desktop 沒有即時用量顯示。
- 兩個服務的限額（5 小時 / 7 天）需要時刻警覺，但目前只能靠手動切回終端機才能看到。

**成功標準**：
1. 不打開任何終端機就能看到 Claude 與 Codex 的 5H / 7D 剩餘額度。
2. 啟動後不需要任何手動操作即可運作（無 API key、無設定）。
3. 在閒置狀態 CPU < 0.5%、RAM < 80MB。

---

## 2. 使用者場景

- **早上開機**：看到懸浮視窗顯示 Claude 5H 0% / 7D 23%、Codex 5H 0% / 7D 7%，知道一天的額度起點。
- **趕專案中**：看到 5H bar 升到 78%，主動切換到 Haiku 或 Codex 來分散用量。
- **多台電腦切換**：在桌機看到 7D 限額遠高於本機 transcript 統計（因為筆電也用了），點刷新按鈕重新掃描本機歷史。
- **不打擾工作**：縮小至系統匣，只在 rate limit 接近上限時透過匣圖示顏色提示。

---

## 3. 顯示模式

### 3.1 兩種模式並存

- **懸浮視窗（Floating Widget）**：預設模式，始終置頂、可拖曳，固定在右下角。
- **系統匣（System Tray）**：縮小後常駐工具列右下角，左鍵點擊重新展開懸浮視窗，右鍵選單包含「展開」、「設定」、「退出」。

兩者可透過懸浮視窗的縮小按鈕 `⊡` 或匣圖示左鍵互相切換。

### 3.2 Compact / Expanded

懸浮視窗本身有兩種大小：
- **Compact**（預設）：寬約 240px，顯示每個服務的 5H、7D bar（含 `%` 與 `resets at` 時間）與一行重點數字。
- **Expanded**：寬約 240px、高度增加，顯示完整 4 項指標（今日 token、本月、模型分佈、快取命中率）。

切換方式：點擊懸浮視窗右上角的 `⊟` / `⊞` 按鈕。

**重要**：兩種大小都會在 bar 上方右側顯示 `resets at` 倒數時間（5H 顯示時刻如 `1:00 AM`、7D 顯示剩餘時長如 `1d23h`）。

---

## 4. 顯示內容

### 4.1 共通元素

- **無標題列**，右上角僅 ⟳（刷新）⊡（最小化至匣）× （關閉到匣，不退出程式）三個按鈕。
- **Claude 區塊**（紫色 #a78bfa 識別）與 **Codex 區塊**（綠色 #34d399 識別）以分隔線完全切開。

### 4.2 Claude 區塊

| 元素 | Compact | Expanded | 資料來源 |
|------|---------|----------|----------|
| 5H USAGE bar + % + resets at | ✓ | ✓ | Hook stdin `rate_limits.five_hour` |
| 7D USAGE bar + % + resets at | ✓ | ✓ | Hook stdin `rate_limits.seven_day` |
| Session 時長 + 模型名 | — | ✓ | Hook stdin `model.display_name` + transcript sessionStart |
| 今日 Token | ✓（純數字） | ✓（含 bar） | Transcript 解析 |
| 本月 Token | — | ✓ | Transcript 解析 |
| 模型分佈條 | — | ✓ | Transcript 解析 |
| 快取命中率 + 節省 tokens | ✓（單行） | ✓（含 bar） | Transcript 解析 |

### 4.3 Codex 區塊

| 元素 | Compact | Expanded | 資料來源 |
|------|---------|----------|----------|
| `plan_type` + 模型名 | ✓（行首） | ✓（行首） | Session JSONL `token_count.rate_limits.plan_type` + `turn_context.model` |
| 5H USAGE bar + % + resets at | ✓ | ✓ | Session JSONL `event_msg.token_count.rate_limits.primary` |
| 7D USAGE bar + % + resets at | ✓ | ✓ | Session JSONL `event_msg.token_count.rate_limits.secondary` |
| 今日 Token | ✓ | ✓（含 bar） | Session JSONL `event_msg.token_count.info.total_token_usage` |
| 本月 Token | — | ✓ | Session JSONL 全月彙整 |
| 快取命中率 + 節省 tokens | ✓（單行） | ✓（含 bar） | `cached_input_tokens / input_tokens` |
| Reasoning Token 比例 | — | ✓（小字） | `reasoning_output_tokens / output_tokens` |

Codex 沒有「模型分佈」是因為訂閱制下 Codex 多半固定使用單一模型；如未來支援多模型再加。**Codex 有快取資料**（`cached_input_tokens`），所以快取命中率與節省 tokens 都可顯示。

---

## 5. 視覺設計

### 5.1 配色

- **背景**：`#1a1a2e`（深紫黑）/ 內層卡片 `#0f0f1a` / 邊框 `#2d2d4e`
- **Claude 主色**：紫色漸層 `linear-gradient(90deg, #7c3aed, #a78bfa)`
- **Codex 主色**：綠色漸層 `linear-gradient(90deg, #059669, #34d399)`
- **文字主色** `#e9d5ff` / **次要** `#6b7280` / **弱化** `#4b5563`

### 5.2 模型分佈配色（色盲友善）

不使用同色相的明暗差，改用色相差距大的三色：
- **Sonnet**：紫 `#7c3aed → #a78bfa`
- **Opus**：橘 `#f59e0b → #fbbf24`
- **Haiku**：青 `#06b6d4 → #22d3ee`

### 5.3 進度條

統一使用 CSS 漸層 + 圓角，高度 4-5px。**不使用** ASCII 風格 bar（如 `[█░░░░░░░░░]`）。

### 5.4 排版

- 字型：`system-ui, sans-serif`
- 區塊圓角 `border-radius: 10px`
- 整體陰影：`box-shadow: 0 4px 24px rgba(124,58,237,0.3)`

---

## 6. 資料來源與更新機制

### 6.1 Claude — 即時資料（透過 Hook）

註冊 Claude Code 的 `Stop` hook（同 claude-hud 機制），hook 腳本將 stdin JSON 寫入：
```
~/.claude/claudegauge-live.json
```

包含關鍵欄位：
- `context_window.used_percentage`
- `rate_limits.five_hour.used_percentage` / `resets_at`
- `rate_limits.seven_day.used_percentage` / `resets_at`
- `model.display_name`
- `transcript_path`、`session_id`

Tauri Rust 後端使用 `notify` crate 監聽該檔案的 mtime，變化時讀取並透過 Tauri IPC `emit` 到前端。

### 6.2 Claude — 歷史資料（掃描 transcript）

掃描 `~/.claude/projects/**/transcript.jsonl`：
- **今日**：篩選 timestamp 在今天本地時區範圍內的訊息
- **本月**：篩選 timestamp 在本月本地時區範圍內的訊息
- **模型分佈**：依 `message.model` 分組統計 token
- **快取命中率**：`cache_read_input_tokens / (input_tokens + cache_read_input_tokens + cache_creation_input_tokens)`
- **節省 tokens**：`cache_read_input_tokens` 總和

### 6.3 Codex — 即時資料（讀取最新 session）

找出 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 修改時間最新的檔案：
1. 從尾端往前掃，找到最後一個 `event_msg` 且 `payload.type == "token_count"` 的事件
2. 取出 `rate_limits.primary` (5H) 與 `rate_limits.secondary` (7D)
3. 也順便取 `plan_type` 與最新 `turn_context.model`

由 Rust 後端使用 `notify` crate 監聽 `~/.codex/sessions/` 整個目錄，新增或修改檔案時觸發重新解析。

### 6.4 Codex — 歷史資料（掃描 sessions）

掃描 `~/.codex/sessions/YYYY/MM/DD/*.jsonl`：
- 從每個 session 取最後一個 `event_msg.token_count.info.total_token_usage`（這是該 session 結束時的累計值）
- 加總所有 session 的 `input_tokens` / `cached_input_tokens` / `output_tokens` / `reasoning_output_tokens`
- 快取命中率：`Σ cached_input_tokens / Σ input_tokens`
- 節省 tokens：`Σ cached_input_tokens`
- 依檔名時間戳（`rollout-YYYY-MM-DDTHH-MM-SS-...`）判斷今日 / 本月歸屬

### 6.5 手動刷新按鈕（⟳）

點擊後重新執行 6.2 與 6.4 的完整掃描。即時資料（6.1、6.3）由 file watcher 持續更新，不需手動觸發。

### 6.6 跨裝置限制說明

- **5H / 7D bars 是跨裝置同步的**（來自 Anthropic / OpenAI 伺服器回傳的 used_percent）。
- **今日 / 本月 token 統計只反映本機 transcript**，因為訂閱制不開放查帳 API。此限制在設定頁面以小字註明。

---

## 7. 技術架構

### 7.1 技術棧

- **桌面框架**：Tauri 2.x
- **後端語言**：Rust（穩定版）
- **前端框架**：React 19 + TypeScript + Vite
- **狀態管理**：Zustand（輕量、不需要 Redux 等級的複雜性）
- **檔案監聽**：`notify` crate（Rust）
- **JSONL 解析**：`serde_json` + 串流逐行讀取（Rust）

### 7.2 模組劃分

```
claudegauge/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Tauri 入口、視窗 / tray 設定
│   │   ├── hooks/
│   │   │   ├── claude_live.rs    # 監聽 claudegauge-live.json
│   │   │   └── codex_live.rs     # 監聽 ~/.codex/sessions/
│   │   ├── parsers/
│   │   │   ├── claude_transcript.rs  # 解析 ~/.claude/projects/**
│   │   │   └── codex_session.rs      # 解析 ~/.codex/sessions/**
│   │   ├── aggregator.rs         # 今日/本月彙整邏輯
│   │   ├── models.rs             # 共用資料結構
│   │   └── ipc.rs                # Tauri command 定義
│   ├── icons/                    # tray icon（正常/警告/危險三色）
│   └── tauri.conf.json
└── src/
    ├── components/
    │   ├── FloatingWidget.tsx    # 主視窗容器
    │   ├── ClaudeSection.tsx     # Claude 區塊
    │   ├── CodexSection.tsx      # Codex 區塊
    │   ├── UsageBar.tsx          # 共用進度條元件
    │   └── ModelDistribution.tsx
    ├── hooks/
    │   ├── useLiveData.ts        # 訂閱 Tauri 事件
    │   └── useHistoricalData.ts  # 呼叫 invoke('refresh_history')
    ├── store/
    │   └── useStore.ts           # Zustand store
    └── main.tsx
```

### 7.3 資料流

```
[Claude Hook] → claudegauge-live.json →┐
                                       ├→ Rust file watcher → Tauri emit → React useLiveData hook → Zustand store → UI
[Codex Sessions] → rollout-*.jsonl ────┘

[手動刷新] → invoke('refresh_history') → Rust 掃描 transcript / sessions → return aggregate → Zustand store → UI
```

### 7.4 啟動流程

1. **第一次啟動**：自動寫入 Claude Code hook 設定到 `~/.claude/settings.json`，使用 `Stop` hook（每次 Claude 完成一輪回應即觸發）寫一個 cmd / sh 將 stdin JSON 落地到 `~/.claude/claudegauge-live.json`。
2. **後續啟動**：直接讀取現有 `claudegauge-live.json` 顯示最後一次的數據，同時開始 file watcher。
3. **歷史資料**：啟動後背景執行第一次 history scan，掃完後更新 UI。
4. **解除安裝清理**：提供「移除 hook」按鈕在設定頁，按下後從 `settings.json` 移除對應 hook 條目。

---

## 8. 系統匣（Tray）行為

- 圖示顏色根據兩個服務的最高 7D 使用率：
  - `< 70%`：紫色（正常）
  - `70-90%`：橘色（警告）
  - `> 90%`：紅色（危險）
- 左鍵：展開 / 隱藏懸浮視窗
- 右鍵選單：
  - 展開懸浮視窗
  - 重新掃描歷史
  - 設定（首次啟動可選）
  - 開機啟動（toggle）
  - 退出

---

## 9. 設定（簡化）

訂閱制下沒有 API key，所以設定很少：
- **啟動行為**：開機啟動 / 預設懸浮視窗 / 預設最小化至匣
- **位置記憶**：懸浮視窗最後位置（自動）
- **重新掃描歷史的快捷鍵**（可選）

設定存放於 `~/.claudegauge/config.json`。

---

## 10. 範圍外（YAGNI）

以下功能本期**不做**，避免膨脹：
- ❌ Anthropic / OpenAI API key 整合（訂閱制不適用）
- ❌ 費用估算（訂閱制下沒有意義）
- ❌ 7 天 / 30 天歷史趨勢圖
- ❌ Session 詳細列表
- ❌ macOS / Linux 支援（先做 Windows）
- ❌ 通知 / 警告聲音
- ❌ 多語系（先做繁體中文）
- ❌ 主題切換（只有深色紫羅蘭一套）

---

## 11. 未解的技術問題

以下需要在實作階段第一個 PR 內回答（每題寫一張 spike PR，得到結論後直接寫入 implementation plan，不需回到 spec）：

1. **Claude Hook 寫入策略**：是否直接編輯 `~/.claude/settings.json` 加入 Stop hook？或包成 Claude Code plugin 透過 marketplace 安裝？前者實作快但侵入性高，後者需研究 plugin 規範。
2. **Codex session 寫入時機**：`event_msg.token_count` 是在 Codex 每次回應後即時 flush，還是 session 結束才寫？若是後者，5H/7D 即時性會有延遲，需考慮備援方案（如監聽 Codex 的 SQLite logs）。
3. **Tauri 2 在 Windows 11 上的 system tray 是否支援動態顏色圖示**？若不支援，改用三張預先繪製的 PNG 切換。
4. **WebView2 在 Windows 10（舊版）是否預裝**？若否，需要在安裝程式中內嵌 WebView2 Runtime 安裝。
5. **多個 Codex session 同時開啟時 rate_limits 重複**：若使用者同時開兩個 Codex thread，兩個 session 檔都會寫入 token_count。需確認是否取「最新 timestamp」就足夠（因為 rate limit 是帳號層級的）。
