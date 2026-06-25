import { homedir } from "node:os";
import { join } from "node:path";

/** 認証情報の保存先（リポジトリ外・ローカル完結）。 */
export const credentialsPath = join(
  homedir(),
  ".my-kanban",
  "credentials.json",
);
