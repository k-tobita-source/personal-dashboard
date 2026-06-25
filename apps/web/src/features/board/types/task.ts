import type { RouterOutputs } from "@acme/api";

/** ボードに並ぶタスク（UI 上は「カード」として描画する） */
export type Task = RouterOutputs["task"]["all"][number];
