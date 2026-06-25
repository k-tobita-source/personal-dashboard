import { Board } from "~/features/board/components/Board";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

// ローカル DB を読むため静的プリレンダリングはせず常に動的レンダリングする
export const dynamic = "force-dynamic";

export default function HomePage() {
  prefetch(trpc.task.all.queryOptions());

  return (
    <HydrateClient>
      <Board />
    </HydrateClient>
  );
}
