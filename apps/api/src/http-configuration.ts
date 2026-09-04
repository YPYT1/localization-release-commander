import type { INestApplication } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";

export function configureHttpBodyParsing(app: INestApplication): void {
  const adapter = app.getHttpAdapter() as ExpressAdapter;
  adapter.useBodyParser("json", false, { limit: "2100kb" });
  adapter.useBodyParser("urlencoded", false, { extended: true, limit: "64kb" });
}
