import { integrationRouter } from "./router/integration";
import { taskRouter } from "./router/task";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  task: taskRouter,
  integration: integrationRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
