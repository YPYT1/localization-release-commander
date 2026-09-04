import { Controller, Get, Header, Param, ParseUUIDPipe, StreamableFile } from "@nestjs/common";
import { CurrentPrincipal, type AuthPrincipal } from "./auth/auth.js";
import { AssetService } from "./asset.service.js";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetService) {}

  @Get(":id/content")
  @Header("Cache-Control", "private, no-store")
  async content(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<StreamableFile> {
    const content = await this.assets.openAuthorized(id, principal);
    return new StreamableFile(content.stream, {
      type: content.contentType,
      disposition: contentDisposition(content.fileName),
      length: content.sizeBytes,
    });
  }
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="asset"; filename*=UTF-8''${encoded}`;
}
