import { BadRequestException, CanActivate, ConflictException, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthPrincipal } from "./auth/auth.js";
import { ProjectAccessService } from "./auth/project-access.service.js";
import { isAssetMutableState } from "./domain/repository.js";

interface UploadRequest {
  params?: { id?: string };
  principal?: AuthPrincipal;
}

@Injectable()
export class UploadAssetGuard implements CanActivate {
  constructor(private readonly access: ProjectAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    const releaseId = request.params?.id;
    if (!releaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(releaseId)) {
      throw new BadRequestException("release id must be a UUID v4");
    }
    if (!request.principal) throw new UnauthorizedException();
    const release = await this.access.requireReleaseRecord(request.principal, releaseId);
    if (!isAssetMutableState(release.state)) throw new ConflictException(`Assets cannot be changed while release is ${release.state}`);
    return true;
  }
}
