import type { TRPCRouterRecord } from "@trpc/server";

import { isConnected } from "@pdash/integrations";

import { run } from "../service/syncService";
import { publicProcedure } from "../trpc";

export const integrationRouter = {
  /** Google 接続状態 */
  status: publicProcedure.query(() => ({ connected: isConnected() })),

  /** 期限の来たソースを同期し処理件数を返す */
  sync: publicProcedure.mutation(() => run()),
} satisfies TRPCRouterRecord;
