import { describe, it, expect, beforeAll } from "vitest";
import { prisma, testUser } from "./setup";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;
const SECRET = process.env.JWT_SECRET || "test-secret-minimum-32-characters-long-for-testing";

let otherUserToken: string;
let otherUserChannelId: number;

beforeAll(async () => {
  const hash = await bcrypt.hash("other123456", 12);
  const other = await prisma.user.create({
    data: { email: "other@lacasa.com", name: "Other", password: hash, avatar: "OT" },
  });
  otherUserToken = jwt.sign({ id: other.id }, SECRET, { expiresIn: "1h" });

  const ch = await prisma.channel.create({
    data: { name: "Other Channel", userId: other.id },
  });
  otherUserChannelId = ch.id;
});

async function reqAs(token: string, path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: res.status, data: await res.json() };
}

describe("Ownership Security", () => {
  it("User A cannot see User B's channels", async () => {
    const { data } = await reqAs(testUser.token, "/channels");
    expect(data.every((c: any) => c.userId === testUser.id)).toBe(true);
  });

  it("User A cannot update User B's channel", async () => {
    const { status } = await reqAs(testUser.token, `/channels/${otherUserChannelId}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(status).toBe(404);
  });

  it("User A cannot delete User B's channel", async () => {
    const { status } = await reqAs(testUser.token, `/channels/${otherUserChannelId}`, {
      method: "DELETE",
    });
    expect(status).toBe(404);
  });

  it("User A cannot create video in User B's channel", async () => {
    const { status } = await reqAs(testUser.token, "/videos", {
      method: "POST",
      body: JSON.stringify({ title: "Sneaky", channelId: otherUserChannelId }),
    });
    expect(status).toBe(403);
  });

  it("Invalid token is rejected", async () => {
    const { status } = await reqAs("invalid.token.here", "/channels");
    expect(status).toBe(401);
  });

  it("Missing token is rejected", async () => {
    const res = await fetch(`${BASE}/channels`);
    expect(res.status).toBe(401);
  });
});
