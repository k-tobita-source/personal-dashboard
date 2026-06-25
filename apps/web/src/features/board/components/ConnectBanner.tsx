"use client";

/** Google 未接続時に表示する接続導線バナー */
export function ConnectBanner() {
  return (
    <div className="flex items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        Google（Calendar /
        Gmail）が未接続です。接続すると当日の予定と未読メールが表示されます。
      </span>
      <a
        href="/api/auth/google"
        className="border-primary text-primary hover:bg-primary/10 shrink-0 rounded-md border px-3 py-1 font-medium"
      >
        Google を接続
      </a>
    </div>
  );
}
