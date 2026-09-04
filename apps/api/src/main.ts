import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureHttpBodyParsing } from "./http-configuration.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureHttpBodyParsing(app);
  app.enableShutdownHooks();
  app.enableCors({ origin: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000" });
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
