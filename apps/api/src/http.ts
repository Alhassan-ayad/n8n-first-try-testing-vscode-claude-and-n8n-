import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z, ZodTypeAny } from 'zod';
import { config } from '@cep/core';
import { prisma, splitCsv } from '@cep/db';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.issues);
  return r.data;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    admin?: { id: string; email: string; name: string; roles: string[] };
  }
}

// ── Admin auth (JWT + roles) ────────────────────────────────────────────────

export interface AdminJwt {
  sub: string;
  email: string;
  name: string;
  roles: string[];
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  let payload: AdminJwt;
  try {
    payload = await req.jwtVerify<AdminJwt>();
  } catch {
    throw new HttpError(401, 'Not signed in');
  }
  const user = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) throw new HttpError(401, 'Account disabled');
  req.admin = { id: user.id, email: user.email, name: user.name, roles: splitCsv(user.roles) };
}

export function hasRole(req: FastifyRequest, ...roles: string[]): boolean {
  const mine = req.admin?.roles ?? [];
  return mine.includes('admin') || roles.some((r) => mine.includes(r));
}

export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest) => {
    if (!hasRole(req, ...roles)) throw new HttpError(403, `Requires one of: ${roles.join(', ')}`);
  };
}

export function actor(req: FastifyRequest): string {
  return req.admin?.email ?? 'system';
}

// ── Client API auth (HMAC from the mngm backend) ────────────────────────────
// Header x-cep-timestamp: unix seconds; x-cep-signature: hex HMAC-SHA256 of
// `${timestamp}.${METHOD}.${path}.${rawBody}` with CLIENT_API_HMAC_SECRET.

export function signClientRequest(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${method.toUpperCase()}.${path}.${body}`).digest('hex');
}

export async function requireClientHmac(req: FastifyRequest): Promise<void> {
  const ts = req.headers['x-cep-timestamp'];
  const sig = req.headers['x-cep-signature'];
  if (typeof ts !== 'string' || typeof sig !== 'string') throw new HttpError(401, 'Missing signature');
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) throw new HttpError(401, 'Stale signature');
  const path = req.url.split('?')[0]!;
  const expected = signClientRequest(config().CLIENT_API_HMAC_SECRET, ts, req.method, path, req.rawBody ?? '');
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    throw new HttpError(401, 'Bad signature');
  }
}

export function sendCsv(reply: FastifyReply, filename: string, rows: Array<Record<string, unknown>>): FastifyReply {
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(`﻿${csv}`);
}

export function paging(q: { page?: string | number; pageSize?: string | number }) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50) || 50));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
