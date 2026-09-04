import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, AUTH_COOKIE } from "@/lib/api";

export async function POST(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ message: "请求来源无效。" }, { status: 403 });
  }
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: "会话无效或已过期。" }, { status: 401 });

  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;") || !request.body) {
    return NextResponse.json({ message: "请求必须包含 multipart 文件。" }, { status: 400 });
  }

  const { releaseId } = await params;
  try {
    const upstream = await fetch(new URL(`/releases/${encodeURIComponent(releaseId)}/assets/upload`, API_BASE_URL), {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": contentType },
      body: request.body,
      cache: "no-store",
      signal: request.signal,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "cache-control": "no-store", "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
    if (upstream.status === 401) {
      response.cookies.set(AUTH_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ message: "资产服务暂时不可用。" }, { status: 502 });
  }
}

function sameOrigin(request: Request): boolean {
  const value = request.headers.get("origin");
  const host = request.headers.get("host") ?? request.headers.get("x-forwarded-host");
  if (!value || !host) return false;
  try {
    const origin = new URL(value);
    const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
    return origin.host === host && origin.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
