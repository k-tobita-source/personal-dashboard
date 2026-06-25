# Google 連携セットアップ（Calendar / Gmail）

読み取り専用・ローカル完結。当日の Calendar 予定を Schedule レーンへ、未読 Gmail を Todo レーンへ取り込む。

## 手順

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（既存でも可）。
2. 「APIとサービス」→「ライブラリ」で **Google Calendar API** と **Gmail API** を有効化。
3. 「OAuth 同意画面」を設定（User type は個人なら External）。
   - スコープに `.../auth/calendar.readonly` と `.../auth/gmail.readonly` を追加。
   - 公開ステータスが「テスト」の場合、自分の Google アカウントを「テストユーザー」に追加。
4. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI に次を追加:
     `http://localhost:3000/api/auth/google/callback`
5. 発行された client ID / secret を、リポジトリ直下の `.env` に設定:

   ```sh
   GOOGLE_CLIENT_ID='...'
   GOOGLE_CLIENT_SECRET='...'
   ```

6. `pnpm dev:next` で起動し、ボード上部の「Google を接続」から認可。

## 注意

- トークンは `~/.personal-dashboard/credentials.json` にのみ保存され、リポジトリには含まれません。
- 本アプリは Calendar / Gmail を**読み取りのみ**で、書き込み・削除は一切行いません。
- 同期はブラウザのタブが表示されている間だけ実行されます（非表示・スリープ中は停止）。
