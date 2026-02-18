import type { Context } from "hono";
import { createDatabase, type Database } from "../db";
import type { Env } from "../env";

export type DBContext = {
  Bindings: Env;
  Variables: {
    db: Database;
  };
};

export const dbMiddleware = async (
  c: Context<DBContext>,
  next: () => Promise<void>,
) => {
  const db = createDatabase(c.env.DB);
  c.set("db", db);
  await next();
};
