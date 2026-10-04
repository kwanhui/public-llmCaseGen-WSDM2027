import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth/edge-config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isAdminRoute = path.startsWith("/admin");
  const isLoginRoute = path.startsWith("/admin/login");
  const isAuthed = !!req.auth;

  if (isAdminRoute && !isLoginRoute && !isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(url);
  }

  if (isLoginRoute && isAuthed) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
