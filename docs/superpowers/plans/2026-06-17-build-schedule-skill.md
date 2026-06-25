# build-schedule スキル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 毎朝 1 コマンドで当日の schedule レーンを全自動で組み立て、学習メモで精度を上げていく Claude Code 用プロジェクトスキル `build-schedule` を作る。

**Architecture:** 成果物は実行可能コードではなく、`.claude/skills/build-schedule/` 配下の Markdown（SKILL.md = 実行アルゴリズム、learnings.template.md = 学習メモ雛形）と `.gitignore` 1 行。スキルは my-kanban MCP の既存ツール（`list_tasks` / `move_task` / `update_task`）のみを使い、新規 MCP ツールは追加しない。検証は実 MCP に対してスキルを起動し、組まれた schedule が妥当かを目視確認する。

**Tech Stack:** Claude Code Skill（SKILL.md frontmatter + Markdown）、my-kanban MCP サーバー（stdio）、SQLite ボード。

## Global Constraints

- スキル配置先: `.claude/skills/build-schedule/`（プロジェクトスキル、kebab-case ディレクトリ）。
- SKILL.md frontmatter は `name` / `description` 必須。`name` は `build-schedule`。
- 使用 MCP ツールは既存の `mcp__my-kanban__list_tasks` / `mcp__my-kanban__move_task` / `mcp__my-kanban__update_task` のみ。新規ツール追加・サービス層変更は行わない。
- 実行モードは**全自動配置**（確認ダイアログなし）。当日のみ対象。
- タイムゾーンは JST 固定。稼働枠の時刻（10:00 等）は JST で解釈し、`move_task` には JST オフセット付き ISO（例 `2026-06-17T10:00:00+09:00`）を渡す。`list_tasks` 返り値の UTC ISO は JST へ直して突き合わせる。
- 固定ブロック（calendar 予定 + 既存 schedule タスク）は**動かさない**。inbox の todo/slack/gmail から重要なものだけ選び、隙間を埋める。
- 既定稼働枠: 平日 10:00–19:00 / 昼休み 12:00–13:00。グリッドは 15 分スナップ。所要時間既定 60 分。
- 学習メモ実体 `learnings.md` は `.gitignore` 対象。リポジトリには `learnings.template.md` のみコミット。スキルは実体が無ければテンプレートから生成する。
- ドキュメント・ファイル名規約は CLAUDE.md / docs/frontend-guideline.md 準拠（ディレクトリ kebab-case）。

---

### Task 1: 学習メモのテンプレートと .gitignore

**Files:**
- Create: `.claude/skills/build-schedule/learnings.template.md`
- Modify: `.gitignore`（末尾に追記）

**Interfaces:**
- Produces: 学習メモの固定セクション構造（`# 稼働時間` / `# 配置ルール` / `# タスク種別ごとの所要時間` / `# 選別基準` / `# やらないこと`）。Task 2 の SKILL.md がこのセクション名を参照して読み書きする。

- [ ] **Step 1: テンプレートファイルを作成**

`.claude/skills/build-schedule/learnings.template.md`:

```markdown
# 学習メモ（build-schedule）

このファイルは build-schedule スキルが毎回読み込み・追記する好みの蓄積です。
各セクションに 1 行ずつ箇条書きで追記してください。古く矛盾する行は上書き/削除して構いません。
初回実行時、`learnings.md` が無ければこのテンプレートをコピーして生成します。

# 稼働時間
- 平日 10:00–19:00 / 昼休み 12:00–13:00

# 配置ルール
<!-- 例: 朝イチ(10:00–12:00)は集中作業を優先で置く / 会議は午後に寄せる -->

# タスク種別ごとの所要時間
<!-- 例: コードレビュー = 30分 / 1on1 = 30分 -->

# 選別基準
- 締切が今日/明日のものを最優先
- slack / gmail 由来は当日中に一次対応
- inbox 滞留が長いものを優先的に消化

# やらないこと
<!-- 例: 金曜午後はミーティングを入れない -->
```

- [ ] **Step 2: .gitignore に learnings.md を追記**

`.gitignore` の末尾に以下を追記する（実体は無視、テンプレートは追跡）:

```gitignore
# build-schedule スキルの学習メモ実体（テンプレートのみ追跡）
.claude/skills/build-schedule/learnings.md
```

- [ ] **Step 3: 無視設定を検証**

Run: `git check-ignore .claude/skills/build-schedule/learnings.md && git status --porcelain .claude/skills/build-schedule/learnings.template.md`
Expected: 1 行目で `learnings.md` のパスが出力される（= 無視対象）。2 行目で `?? .claude/skills/build-schedule/learnings.template.md`（= 追跡候補）が出力される。

- [ ] **Step 4: コミット**

```bash
git add .claude/skills/build-schedule/learnings.template.md .gitignore
git commit -m "feat(skill): build-schedule の学習メモ雛形と gitignore を追加"
```

---

### Task 2: SKILL.md（実行アルゴリズム本体）

**Files:**
- Create: `.claude/skills/build-schedule/SKILL.md`

**Interfaces:**
- Consumes: Task 1 の learnings セクション構造、既存 MCP ツール `mcp__my-kanban__list_tasks` / `mcp__my-kanban__move_task` / `mcp__my-kanban__update_task`。
- Produces: ユーザーが `/build-schedule` または「今日のスケジュールを組み立てて」で起動できる動作。

- [ ] **Step 1: SKILL.md を作成**

`.claude/skills/build-schedule/SKILL.md`:

````markdown
---
name: build-schedule
description: 当日の schedule レーンを全自動で組み立てる。inbox の todo/slack/gmail から重要なものを選び、calendar 予定と既存 schedule タスクの隙間に時間割を割り当てる。「今日のスケジュールを組み立てて」「schedule を組んで」「/build-schedule」で起動。毎回 learnings.md を読み込み・追記して精度を上げる。
---

# build-schedule

my-kanban の当日 schedule レーンを**全自動**で組み立てる。MCP ツール
`mcp__my-kanban__list_tasks` / `move_task` / `update_task` のみを使う。

## 前提・規約

- タイムゾーンは **JST 固定**。稼働枠の時刻（10:00 等）は JST で解釈し、`move_task`
  には JST オフセット付き ISO（例 `2026-06-17T10:00:00+09:00`）を渡す。
  `list_tasks` 返り値の `startAt`/`endAt` は UTC ISO なので JST に直して突き合わせる。
- 固定ブロック（**動かさない**）: source=calendar の予定 + すでに lane=schedule にある
  タスク全て。
- 配置候補: lane=inbox の todo / slack / gmail。**重要なものだけ**選別する（詰め込みすぎない）。
- グリッドは 15 分スナップ。所要時間の既定は 60 分。

## 手順

### 1. 学習メモを読む

`.claude/skills/build-schedule/learnings.md` を読む。**無ければ**同ディレクトリの
`learnings.template.md` をコピーして `learnings.md` を作成してから読む。
セクション: `# 稼働時間` / `# 配置ルール` / `# タスク種別ごとの所要時間` /
`# 選別基準` / `# やらないこと`。

### 2. 盤面を取得して仕分け

`list_tasks`（引数なし）で全タスクを取得し、以下に仕分ける:
- **固定ブロック**: source=calendar かつ startAt が今日のもの、および lane=schedule の全タスク。
- **配置候補**: lane=inbox の todo / slack / gmail。

### 3. 前日実績から軽く学習（任意）

現盤面から、前回配置に対する明確な傾向（特定種別を毎回早く done にしている、
特定時間帯のタスクを inbox に戻している等）が**確信を持って**読み取れる場合のみ、
learnings の該当セクションに 1 行追記する。確信が持てなければ何もしない（ノイズを増やさない）。

### 4. 稼働枠と空き時間を決める

learnings `# 稼働時間`（既定 10:00–19:00 / 昼休み 12:00–13:00）を JST の当日日付に
適用する。昼休みと固定ブロックを除いた**空き時間スロット**を 15 分スナップで列挙する。

### 5. 重要タスクを選別

learnings `# 選別基準` に従う。learnings が空ならフォールバック:
1. 締切・日付の手がかり（title/body の「今日」「明日」「期限」等）が近いもの。
2. slack / gmail 由来は当日一次対応として優先。
3. 同条件なら inbox 滞留が長い（古い）ものを優先。

### 6. 所要時間を見積もる

learnings `# タスク種別ごとの所要時間` に一致があればそれを、なければ既定 60 分。

### 7. 隙間にパックする

learnings `# 配置ルール`（例: 朝は集中作業）に従って順序を決め、選んだタスクを
空き時間スロットへ詰める。各タスクを次で確定する:

`move_task({ id, lane: "schedule", startAt: <JST ISO>, endAt: <JST ISO> })`

- 稼働枠に収まる上位のみ配置。あふれた分は inbox に残す。
- `# やらないこと` の制約に反する配置はしない。

### 8. 結果を要約して報告

- 組んだタイムライン（時刻 + タイトル）を時系列で一覧表示。
- inbox に残したタスクとその理由（時間不足 / 優先度低 等）を列挙。

### 9. フィードバックを吸収

ユーザーが補正コメント（例「朝は会議入れないで」「レビューは 30 分で十分」）を
返したら、learnings の該当セクションに 1 行追記する。可能なら指示どおり再配置する。

## エッジケース

- **空き時間なし** → 配置せず「本日は固定予定で埋まっています」と報告。
- **配置候補ゼロ** → 「inbox に今日やるべきタスクはありません」と報告。
- **重要タスク過多** → 稼働枠に収まる上位のみ配置し、残りは inbox に残して理由を報告。

## スコープ外

確認ダイアログ / 段階配置、複数日・週次、カレンダーへの書き戻し、MCP ツール新規追加。
````

- [ ] **Step 2: frontmatter の妥当性を確認**

Run: `head -5 .claude/skills/build-schedule/SKILL.md`
Expected: 1 行目 `---`、`name: build-schedule`、`description:` を含む YAML frontmatter が出力される。

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/build-schedule/SKILL.md
git commit -m "feat(skill): build-schedule の実行アルゴリズム(SKILL.md)を追加"
```

---

### Task 3: 実 MCP に対する起動検証（ドライ実行）

**Files:**
- なし（動作確認のみ。必要に応じて SKILL.md / learnings.template.md を微修正）

**Interfaces:**
- Consumes: Task 1・2 の成果物、稼働中の my-kanban MCP サーバー（`enabledMcpjsonServers: ["my-kanban"]`）。

- [ ] **Step 1: スキルが認識されることを確認**

新しい Claude Code セッション（またはスキル再読込）で `/build-schedule` が候補に出る、
もしくは Skill ツールに `build-schedule` が現れることを確認する。

- [ ] **Step 2: 起動して schedule を組ませる**

「今日のスケジュールを組み立てて」と指示し、スキルを起動する。
期待挙動:
- 初回は `learnings.md` がテンプレートから生成される（`ls .claude/skills/build-schedule/learnings.md` で存在確認）。
- `list_tasks` → `move_task` の順で MCP が呼ばれる。
- calendar 予定と既存 schedule タスクが**動いていない**こと。
- inbox の候補が稼働枠（10:00–19:00 / 昼休み除外）の空きに 15 分スナップで入っていること。
- 最後にタイムライン要約と inbox 残しの理由が報告されること。

- [ ] **Step 3: Web で目視確認**

`pnpm dev:next` 起動済みなら http://localhost:3000 を開き、schedule レーンの時間割が
妥当か（重なり無し・昼休み空き・固定予定保持）を目視する。

- [ ] **Step 4: フィードバック学習を確認**

補正コメント（例「レビューは 30 分で」）を 1 つ与え、`learnings.md` の該当セクションに
1 行追記されることを確認する。

- [ ] **Step 5: 不具合があれば SKILL.md を修正し再検証**

挙動が手順と乖離する場合のみ SKILL.md を Edit し、Step 2 から再実行する。修正したら:

```bash
git add .claude/skills/build-schedule/SKILL.md
git commit -m "fix(skill): build-schedule の挙動を検証結果に合わせて調整"
```

---

## Self-Review

**1. Spec coverage:**
- 実行モード=全自動 → Global Constraints + SKILL.md 手順 7（確認なし）✓
- 学習メモ方式 → Task 1（テンプレ + gitignore）+ SKILL.md 手順 1・9 ✓
- 重要なものだけ選別 → SKILL.md 手順 5 ✓
- 稼働枠 10:00–19:00 / 昼休み → Global Constraints + 手順 4 ✓
- 既存 schedule 固定で隙間埋め → Global Constraints + 手順 2・7 ✓
- 前日実績からの学習 → 手順 3 ✓
- エッジケース（空きなし/候補ゼロ/過多）→ SKILL.md エッジケース節 ✓
- TZ / git 扱い → Global Constraints + Task 1 ✓

**2. Placeholder scan:** TBD/TODO 等なし。テンプレ内の `<!-- 例 ... -->` は学習メモの記入例コメントで、プラン側のプレースホルダではない。✓

**3. Type consistency:** learnings のセクション名（`# 稼働時間` 他）が Task 1 と Task 2 で一致。MCP ツール名 `move_task` / `list_tasks` / `update_task` を全体で統一。✓
