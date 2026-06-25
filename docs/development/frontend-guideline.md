# フロントエンド開発ガイドライン

## 目的

本ドキュメントは、フロントエンド開発における基準を明文化し、品質・速度・可読性・保守性を高い水準で両立することを目的とする。

## 基本ルール

- 基本のコーディングルールは ESlint/Prettier の設定値に準拠する。
- プルリクエスト提出前には、必ず以下のチェックを実施する。
  - Prettierによるフォーマット
  - ESLintによる静的解析
  - TypeScriptの型エラーチェック
  - ビルドエラーの確認
- 技術的な実装方針よりも要件やUXを優先する。
  - ユーザー体験を犠牲にしてまで、言語やフレームワークの思想に合わせることはしない。
  - 技術的な美しさや一貫性も重要だが、最終的にはユーザーにとっての価値を最大化することを目指す。

## ディレクトリ構成

```sh
apps/[appName]/frontend/src/
├── app                    # ルーティング定義
│
├── components             # 各画面で横断的に利用する汎用コンポーネント
│   ├── elements
│   └── layouts
│
├── configs                # 各画面で横断的に利用する設定値定数
│
├── features               # 機能・画面単位でコンポーネント/API/hooks/型などをコロケーションする
│   └── [featureName]      # 機能・画面名称
│       ├── api            # API経由のデータ取得処理、コンバート処理
│       ├── actions        # Server Actions
│       ├── configs        # 機能・画面内で利用する設定値定数
│       ├── components     # 機能・画面内で利用するコンポーネント群
│       ├── hooks          # 機能・画面内で利用するカスタムフック
│       ├── schemas        # 機能・画面内で利用するZodスキーマ・infer型
│       ├── types          # 機能・画面内で利用する型
│       ├── utils          # 機能・画面内で利用するユーティリティ
│       └── providers      # 機能・画面内で利用するプロバイダ
│
├── hooks                  # 各画面で横断的に利用するカスタムフック
│
├── providers              # 各画面で横断的に利用するプロバイダ
│
├── schemas                # 各画面で横断的に利用するZodスキーマ・infer型
│
├── types                  # 各画面で横断的に利用する型
│
└── utils                  # 各画面で横断的に利用するユーティリティ
```

### 基本方針

[bulletproof-react](https://github.com/alan2207/bulletproof-react)を踏襲したpackage by featureをベースとし、feature/layerハイブリット構成とする。

### Featureベース構成（コロケーション）

Next.jsのファイルベースルーティングとコロケーションパターンに準拠し、機能・画面単位で`/features/[featureName]`ディレクトリを切りその中で機能に関わるコンポーネント/API/hooks/型を配置する。
関連するコードを近くに配置することで、「このファイルがどこで使われているか」が明確になり、不要なファイルの削除や影響範囲の把握が容易になり、保守性と可読性向上に繋がる。

### Feature横断リソースの管理

機能・画面を横断して利用するリソースは`/features`と並列階層に`/hooks`、`/utils`などのレイヤーディレクトリを作成し配置する。
これにより、レイヤーから影響範囲の特定が容易になり保守性と可読性向上に繋がる。

## 命名規則

| 対象               | 規則                             | 例                                   |
| ------------------ | -------------------------------- | ------------------------------------ |
| ファイル名（.tsx） | PascalCase                       | `ChatMessageList.tsx`                |
| ファイル名（.ts）  | camelCase                        | `getPath.ts`                         |
| コンポーネント     | PascalCase                       | `ChatMessageList`, `Avatar`          |
| フック             | camelCase + “use” プレフィックス | `useChatStream`, `useFormValidation` |
| 型定義             | PascalCase + TypeSuffix (任意)   | `User`, `ChatMessageType`            |
| 定数               | UPPER_SNAKE_CASE                 | `DEFAULT_PAGE_SIZE`                  |
| ディレクトリ名     | kebab-case                       | `rag-masters`                        |

## コンポーネント設計方針

### 単一責任の原則に従う

コンポーネントは、UI・ロジック・状態管理・データハンドリングなど、なるべく複数の責務を混在させないようにする。関心の分離を徹底することで、テストしやすく、再利用しやすいコンポーネントが実現できる。

| 関心                                   | 対応方針                         |
| -------------------------------------- | -------------------------------- |
| **UI表示**                             | コンポーネント内                 |
| **データ取得・更新**                   | APIクライアント                  |
| **状態管理・副作用・ビジネスロジック** | 肥大化する場合はカスタムフック等 |
| **純粋ロジック（計算・変換など）**     | ユーティリティ関数として分離する |

### YAGNIの原則に従う

「You Aren't Gonna Need It（それは必要にならない）」の原則に従い、早すぎる抽象化や過度な分割はコスト増になるため避ける。必要になってから対応することで、過剰な設計を防ぐ。

将来を見越した設計も重要だが、現在の要件に集中し、必要になった時点でリファクタリングする方が、結果的にシンプルで保守しやすいコードになる。

### 状態のコロケーション

状態の保持は必要最小スコープに置く。上位の親コンポーネントへ持ち上げ過ぎない。（リフトアップしすぎない）
状態を必要最小スコープに配置することで、無駄な再レンダリングを抑え、局所性とテスト容易性を高める。

### Container/Presentationalパターンの活用

UIとロジックを明確に分離することで、コードの保守性と再利用性、テストのしやすさを向上させるため、**Container/Presentationalパターン**を活用する。

- **Containerコンポーネント**: データの取得、状態管理、ビジネスロジックなどを担当。
- **Presentationalコンポーネント**: UIのレンダリングに特化し、受け取ったプロパティをもとに見た目を構築する。

#### 目的

- Componentの責務の明確化
  - ロジックはContainer Component、UIはPresentational Componentといった形で責務がはっきりしているので、どこで何を実装しているのかがわかりやすくなる
- テスタビリティの向上
  - 例：UIのテストであればPresentationalなコンポーネントをテストすればOK
- Presentational Componentの再利用性が向上する
  - Presentational ComponentはPropsのみに依存しているので、定義されているPropsさえ渡してあげればどのComponentからも利用することができる

#### Container/Presenterの責務表

|                    | Container Component                      | Prasentational Component                       |
| ------------------ | ---------------------------------------- | ---------------------------------------------- |
| 責務               | ロジック（データ取得・ビジネスロジック） | UI                                             |
| 状態               | 持つ                                     | 原則持たない（UIの振る舞いに必要であれば持つ） |
| データの受け取り元 | API、状態管理ライブラリ                  | Props                                          |

### 関心単位での分割

関心ごとが3つ以上共存している場合（取得・更新・検証・整形・描画など）、分割を検討する。

※以下、TaskListコンポーネントでの例。

| #   | 関心                                     | 処理内容                   |
| --- | ---------------------------------------- | -------------------------- |
| 1   | **取得（I/O）**                          | タスク一覧の取得           |
| 2   | **更新（I/O）**                          | タスクのステータス更新     |
| 3   | **検証（フィルタ入力のバリデーション）** | フィルタ条件の検証         |
| 4   | **並び替え（UI内でsort切り替え）**       | ソート条件の切り替え       |
| 5   | **UI描画（リストと行）**                 | タスク一覧とタスク行の描画 |

#### ① 取得

**APIクライアント** に切り出す。`features/tasks/api/queries.ts`

```ts
import type { Result } from "@/types/result";

import type { Task } from "../types/task";
import { request } from "../lib/request";

export async function getTasks(): Promise<Result<Task[]>> {
  return await request<Task[]>("/api/tasks");
}
```

#### ② 更新

**Server Actions** に切り出す。`features/tasks/api/actions.ts`

```ts
"use server";

import { revalidateTag } from "next/cache";
import { updateTaskStatus } from "@/apis/tasks.server";

export async function updateTaskAction(taskId: string, status: string) {
  const result = await updateTaskStatus(taskId, status);

  if (result.isSuccess) {
    // タスク一覧のキャッシュを再検証
    revalidateTag("tasks");
  }

  return result;
}
```

#### ③ 検証

**カスタムフック** に切り出す。`features/tasks/hooks/useFilterValidation.ts`

```ts
import { useState } from "react";

export function useFilterValidation() {
  const [error, setError] = useState<string | null>(null);

  const isValid = (value: string) => {
    const errorMessage =
      value.length > 100 ? "フィルタ条件は100文字以内で入力してください" : null;
    setError(errorMessage);
    return !errorMessage;
  };

  return { error, isValid };
}
```

#### ④ 並び替え

**ユーティリティ関数** に切り出す。`features/tasks/utils/sortTasks.ts`

```ts
import type { Task } from "@/types/task";

export function sortTasks(tasks: Task[], sortKey: "createdAt" | "priority") {
  return [...tasks].sort((a, b) => {
    if (sortKey === "createdAt") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return b.priority - a.priority;
  });
}
```

#### ⑤ UI

**TaskList** と **TaskItem** に分解します。

`features/tasks/components/TaskList.tsx`

```tsx
import type { Task } from "@/types/task";

import { TaskItem } from "./TaskItem";

type Props = {
  tasks: Task[];
};

export function TaskList({ tasks }: Props) {
  return (
    <ul>
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </ul>
  );
}
```

`features/tasks/components/TaskItem.tsx`

```tsx
import type { Task } from "@/types/task";

type Props = {
  task: Task;
};

export function TaskItem({ task }: Props) {
  return (
    <li>
      <h3>{task.title}</h3>
      <p>{task.description}</p>
    </li>
  );
}
```

このように関心ごとに分割することで、各レイヤーの責任が明確になり、テストしやすく、再利用しやすいコードが実現できる。
