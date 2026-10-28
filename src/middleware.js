import { NextResponse } from "next/server";

export function middleware(request) {
  if (request.nextUrl.pathname === "/api/road-data") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/road-data-v2";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/road-data"],
};
