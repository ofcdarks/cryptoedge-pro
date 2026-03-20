import { describe, it, expect } from "vitest";
import { testUser } from "./setup";

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${testUser.token}` };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: res.status, data: await res.json() };
}

describe("Ideas Routes", () => {
  let ideaId: number;

  it("POST /ideas - creates idea", async () => {
    const { status, data } = await req("/ideas", {
      method: "POST",
      body: JSON.stringify({ title: "Video sobre IA", tags: "tech,ai", color: "#3B82F6" }),
    });
    expect(status).toBe(201);
    expect(data.title).toBe("Video sobre IA");
    ideaId = data.id;
  });

  it("GET /ideas - lists ideas", async () => {
    const { data } = await req("/ideas");
    expect(data.some((i: any) => i.id === ideaId)).toBe(true);
  });

  it("PUT /ideas/:id - pins idea", async () => {
    const { data } = await req(`/ideas/${ideaId}`, {
      method: "PUT",
      body: JSON.stringify({ pinned: true }),
    });
    expect(data.pinned).toBe(true);
  });

  it("DELETE /ideas/:id - deletes idea", async () => {
    const { status } = await req(`/ideas/${ideaId}`, { method: "DELETE" });
    expect(status).toBe(200);
  });
});

describe("Budget Routes", () => {
  let itemId: number;

  it("POST /budget - creates item", async () => {
    const { status, data } = await req("/budget", {
      method: "POST",
      body: JSON.stringify({ category: "Equipamento", desc: "Microfone", value: 500, type: "expense" }),
    });
    expect(status).toBe(201);
    expect(data.value).toBe(500);
    itemId = data.id;
  });

  it("POST /budget - validates input", async () => {
    const { status } = await req("/budget", {
      method: "POST",
      body: JSON.stringify({ category: "", desc: "Bad", value: -1 }),
    });
    expect(status).toBe(400);
  });

  it("DELETE /budget/:id - deletes item", async () => {
    const { status } = await req(`/budget/${itemId}`, { method: "DELETE" });
    expect(status).toBe(200);
  });
});
