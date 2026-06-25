# Slack 連携セットアップ（メンション / DM）

読み取り専用・ローカル完結。過去3日の自分へのメンションと DM を Todo レーンに取り込む。

## 手順

1. [Slack API: Your Apps](https://api.slack.com/apps) で「Create New App」→「From scratch」。任意の名前＋対象ワークスペースを選択。
2. 左メニュー「OAuth & Permissions」→「Scopes」→ **User Token Scopes** に次を追加。
   （Bot Token Scopes ではなく **User Token Scopes** に追加すること。`search.messages` 等はユーザートークン必須。）
   - `search:read` — メッセージ検索（メンション / DM の取得）
   - `channels:read` — 参加中の公開チャンネル一覧（参加チャンネルに限定するため）
   - `groups:read` — 参加中の非公開チャンネル一覧
   - `usergroups:read` — 自分が所属する user group（チームメンション @usergroup の判定）

   既にインストール済みでスコープを追加した場合は、**再インストール（Reinstall to Workspace）して新しいトークンを取得・再設定**すること。
3. 同ページ上部「Install to Workspace」でインストールし、許可。
4. 「OAuth Tokens」の **User OAuth Token**（`xoxp-` で始まる）をコピー。
5. リポジトリ直下の `.env` に設定:

   ```sh
   SLACK_TOKEN='xoxp-...'
   ```

6. `pnpm dev:next` を再起動。タブ表示中、数分間隔で取り込まれる。

## 注意

- トークンはローカルの `.env`（gitignore 済み）にのみ保存。
- 本アプリは Slack を **検索（読み取り）のみ**で、メッセージの送信・変更は一切行わない。
- 取り込み対象は「自分へのメンション」と「自分宛 DM（自分の発言を除く）」の過去3日分。
