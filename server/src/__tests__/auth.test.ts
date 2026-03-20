import { describe, it, expect } from "vitest";
import { testUser, prisma } from "./setup";

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...opts.headers as any };
  if (testUser?.token) headers["Authorization"] = `Bearer ${testUser.token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: res.status, data: await res.json() };
}

describe("Auth Routes", () => {
  it("POST /auth/register - creates user", async () => {
    const { status, data } = await req("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "new@test.com", name: "New User", password: "password123" }),
    });
    expect(status).toBe(201);
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe("new@test.com");
  });

  it("POST /auth/register - rejects duplicate", async () => {
    const { status } = await req("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "new@test.com", name: "Dup", password: "password123" }),
    });
    expect(status).toBe(409);
  });

  it("POST /auth/register - validates input", async () => {
    const { status, data } = await req("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "bad", name: "", password: "12" }),
    });
    expect(status).toBe(400);
    expect(data.details).toBeDefined();
  });

  it("POST /auth/login - succeeds with valid creds", async () => {
    const { status, data } = await req("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "test@lacasa.com", password: "test123456" }),
    });
    expect(status).toBe(200);
    expect(data.token).toBeDefined();
  });

  it("POST /auth/login - fails with wrong password", async () => {
    const { status } = await req("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "test@lacasa.com", password: "wrong" }),
    });
    expect(status).toBe(401);
  });

  it("GET /auth/me - returns current user", async () => {
    const { status, data } = await req("/auth/me");
    expect(status).toBe(200);
    expect(data.email).toBe("test@lacasa.com");
  });

  it("GET /auth/me - rejects without token", async () => {
    const res = await fetch(`${BASE}/auth/me`);
    expect(res.status).toBe(401);
  });
});
