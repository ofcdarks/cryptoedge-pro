import { describe, it, expect } from "vitest";
import { testUser } from "./setup";

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${testUser.token}` };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: res.status, data: await res.json() };
}

describe("Notification Routes", () => {
  it("GET /notifications - lists user notifications", async () => {
    const { status, data } = await req("/notifications");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it("PUT /notifications/read-all - marks all as read", async () => {
    const { status } = await req("/notifications/read-all", { method: "PUT" });
    expect(status).toBe(200);

    const { data } = await req("/notifications");
    expect(data.every((n: any) => n.read === true)).toBe(true);
  });
});

describe("Search Route", () => {
  it("GET /search?q=test - searches across entities", async () => {
    const { status, data } = await req("/search?q=Channel");
    expect(status).toBe(200);
    expect(data).toHaveProperty("videos");
    expect(data).toHaveProperty("ideas");
    expect(data).toHaveProperty("assets");
    expect(data).toHaveProperty("scripts");
  });

  it("GET /search?q=x - returns empty for short query", async () => {
    const { data } = await req("/search?q=x");
    expect(data.videos).toHaveLength(0);
  });
});

describe("Export Route", () => {
  it("GET /export/videos-csv - exports CSV", async () => {
    const res = await fetch(`${BASE}/export/videos-csv`, {
      headers: { Authorization: `Bearer ${testUser.token}` },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ID,Título");
  });
});
