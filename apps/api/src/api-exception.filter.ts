import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { ApiErrorCode, ApiErrorDto } from "@lrc/contracts";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = context.getResponse<{ status(code: number): { json(body: ApiErrorDto): void } }>();
    const request = context.getRequest<{ url?: string }>();
    response.status(statusCode).json({
      statusCode,
      code: errorCode(statusCode),
      message: exception instanceof HttpException ? errorMessage(exception.getResponse(), statusCode) : "Internal server error",
      timestamp: new Date().toISOString(),
      path: request.url ?? "",
    });
  }
}

function errorCode(status: number): ApiErrorCode {
  if (status === HttpStatus.BAD_REQUEST) return "VALIDATION_FAILED";
  if (status === HttpStatus.UNAUTHORIZED) return "UNAUTHORIZED";
  if (status === HttpStatus.FORBIDDEN) return "FORBIDDEN";
  if (status === HttpStatus.NOT_FOUND) return "NOT_FOUND";
  if (status === HttpStatus.CONFLICT) return "CONFLICT";
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return "DEPENDENCY_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

function errorMessage(response: string | object, status: number): string | string[] {
  if (typeof response === "string") return response;
  if (response && typeof response === "object" && "message" in response) {
    const message = (response as { message?: unknown }).message;
    if (typeof message === "string" || Array.isArray(message) && message.every((item) => typeof item === "string")) return message;
  }
  return status >= 500 ? "Internal server error" : "Request failed";
}
