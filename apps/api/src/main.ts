import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { resolveCorsOrigins } from "./cors-origins.js";
import { configureHttpBodyParsing } from "./http-configuration.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureHttpBodyParsing(app);
  app.enableShutdownHooks();
  app.enableCors({ origin: resolveCorsOrigins() });
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
