import { z } from 'zod';
import { sanitizeText } from '@v2rb/parser';
import { AppError } from '@v2rb/core';
import type { ProxyAdapter } from '@v2rb/adapters';
import { hasHostPermission } from '../shared/browser';
import type { RpcErrorPayload, RpcResponse } from '../shared/protocol';
import { buildDiagnostics, buildSnapshot, type BackgroundServices } from './snapshot';

const sourceSchema = z.enum(['manual', 'uri', 'paste', 'file', 'clipboard', 'subscription', 'config']);

const credentialsPatchSchema = z
  .object({
    kind: z.enum(['none', 'uuid', 'password', 'method-password']).optional(),
    uuid: z.string().max(200).optional(),
    password: z.string().max(2000).optional(),
    method: z.string().max(80).optional(),
    flow: z.string().max(80).optional(),
    username: z.string().max(200).optional(),
  })
  .partial();

const securityPatchSchema = z
  .object({
    type: z.enum(['none', 'tls', 'reality']).optional(),
    sni: z.string().max(253).optional(),
    alpn: z.array(z.string().max(40)).max(10).optional(),
    fingerprint: z.string().max(40).optional(),
    publicKey: z.string().max(200).optional(),
    shortId: z.string().max(40).optional(),
    allowInsecure: z.boolean().optional(),
  })
  .partial();

const transportPatchSchema = z
  .object({
    type: z.enum(['tcp', 'ws', 'grpc', 'http', 'h2', 'quic', 'mkcp', 'httpupgrade', 'xhttp', 'kcp']).optional(),
    path: z.string().max(2000).optional(),
    host: z.string().max(253).optional(),
    serviceName: z.string().max(200).optional(),
    mode: z.string().max(80).optional(),
  })
  .partial();

const settingsPatchSchema = z
  .object({
    locale: z.enum(['auto', 'en', 'fa']).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    activeProfileId: z.string().nullable().optional(),
    bypassList: z.array(z.string().max(200)).max(100).optional(),
    healthCheck: z
      .object({ enabled: z.boolean(), url: z.string().max(2000), timeoutMs: z.number() })
      .optional(),
    webRtcLeakGuard: z.boolean().optional(),
    subscriptionAutoRefresh: z
      .object({ enabled: z.boolean(), staleAfterHours: z.number() })
      .optional(),
    onboardingCompleted: z.boolean().optional(),
  })
  .partial();

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state/get') }),
  z.object({
    type: z.literal('profile/add'),
    input: z.string().min(1).max(1_000_000),
    source: sourceSchema.optional(),
    subscriptionId: z.string().max(80).optional(),
  }),
  z.object({
    type: z.literal('profile/add-batch'),
    input: z.string().min(1).max(1_000_000),
    source: sourceSchema.optional(),
  }),
  z.object({
    type: z.literal('profile/update'),
    id: z.string().min(1),
    patch: z.object({
      name: z.string().max(200).optional(),
      tags: z.array(z.string()).max(30).optional(),
      group: z.string().max(80).optional(),
      host: z.string().max(253).optional(),
      port: z.number().int().optional(),
      credentials: credentialsPatchSchema.optional(),
      security: securityPatchSchema.optional(),
      transport: transportPatchSchema.optional(),
    }),
  }),
  z.object({ type: z.literal('profile/remove'), id: z.string().min(1) }),
  z.object({ type: z.literal('profile/set-active'), id: z.string().nullable() }),
  z.object({
    type: z.literal('profile/import-bundle'),
    bundle: z.unknown(),
    mode: z.enum(['merge', 'replace']),
  }),
  z.object({ type: z.literal('profile/export'), includeSecrets: z.boolean() }),
  z.object({ type: z.literal('settings/update'), patch: settingsPatchSchema }),
  z.object({ type: z.literal('connection/connect'), profileId: z.string().min(1) }),
  z.object({ type: z.literal('connection/disconnect') }),
  z.object({ type: z.literal('connection/recheck') }),
  z.object({
    type: z.literal('subscription/add'),
    url: z.string().max(4000),
    name: z.string().max(120).optional(),
  }),
  z.object({ type: z.literal('subscription/refresh'), id: z.string().min(1) }),
  z.object({ type: z.literal('subscription/remove'), id: z.string().min(1) }),
  z.object({ type: z.literal('diagnostics/get') }),
  z.object({ type: z.literal('data/clear'), scope: z.enum(['profiles', 'all']) }),
]);

export interface RouterServices extends BackgroundServices {
  adapter: ProxyAdapter;
}

function ok(data: unknown): RpcResponse<unknown> {
  return { ok: true, data };
}

export function toErrorPayload(error: unknown): RpcErrorPayload {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: sanitizeText(error.message),
      ...(error.detail ? { detail: sanitizeText(error.detail) } : {}),
    };
  }
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION', message: 'The request contained invalid values' };
  }
  return {
    code: 'UNKNOWN',
    message: sanitizeText(error instanceof Error ? error.message : 'Unexpected background error'),
  };
}

export async function handleRequest(raw: unknown, services: RouterServices): Promise<RpcResponse<unknown>> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: toErrorPayload(parsed.error) };
  const request = parsed.data;
  try {
    switch (request.type) {
      case 'state/get':
        return ok(await buildSnapshot(services));

      case 'profile/add':
      case 'profile/add-batch': {
        const result = await services.profiles.addFromText(
          request.input,
          request.source ?? 'uri',
          'subscriptionId' in request ? request.subscriptionId : undefined,
        );
        const db = await services.store.read();
        if (!db.settings.activeProfileId) {
          const candidate = result.added.find((profile) => profile.connectKind);
          if (candidate) await services.settings.update({ activeProfileId: candidate.id });
        }
        return ok({
          snapshot: await buildSnapshot(services),
          added: result.added.length,
          duplicates: result.duplicates.length,
          failures: result.failures,
        });
      }

      case 'profile/update': {
        const patch = request.patch;
        await services.profiles.update(request.id, {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
          ...(patch.group !== undefined ? { group: patch.group } : {}),
          ...(patch.host !== undefined ? { host: patch.host } : {}),
          ...(patch.port !== undefined ? { port: patch.port } : {}),
          ...(patch.credentials ? { credentials: { ...patch.credentials, kind: patch.credentials.kind ?? 'password' } } : {}),
          ...(patch.security ? { security: { ...patch.security, type: patch.security.type ?? 'none' } } : {}),
          ...(patch.transport ? { transport: { ...patch.transport, type: patch.transport.type ?? 'tcp' } } : {}),
        });
        return ok(await buildSnapshot(services));
      }

      case 'profile/remove': {
        const db = await services.store.read();
        const connected = db.runtime.intent === 'on' && db.runtime.profileId === request.id;
        if (connected) await services.controller.disconnect();
        await services.profiles.remove(request.id);
        return ok(await buildSnapshot(services));
      }

      case 'profile/set-active':
        await services.settings.update({ activeProfileId: request.id });
        return ok(await buildSnapshot(services));

      case 'profile/import-bundle': {
        const result = await services.profiles.importBundle(request.bundle, request.mode);
        return ok({ snapshot: await buildSnapshot(services), ...result });
      }

      case 'profile/export':
        return ok(await services.profiles.exportBundle(request.includeSecrets));

      case 'settings/update': {
        const updated = await services.settings.update(request.patch);
        if (request.patch.webRtcLeakGuard !== undefined && services.controller.getState().phase === 'active') {
          await services.adapter.setLeakProtection(updated.webRtcLeakGuard);
        }
        if (request.patch.healthCheck && services.controller.getState().phase === 'active') {
          void services.controller.recheck();
        }
        return ok(await buildSnapshot(services));
      }

      case 'connection/connect': {
        const result = await services.controller.connect(request.profileId);
        const snapshot = await buildSnapshot(services);
        if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message, ...(result.error.detail ? { detail: result.error.detail } : {}) } };
        return ok(snapshot);
      }

      case 'connection/disconnect': {
        const result = await services.controller.disconnect();
        const snapshot = await buildSnapshot(services);
        if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message } };
        return ok(snapshot);
      }

      case 'connection/recheck': {
        const result = await services.controller.recheck();
        if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message } };
        return ok(await buildSnapshot(services));
      }

      case 'subscription/add': {
        if (!(await hasHostPermission(request.url))) {
          return {
            ok: false,
            error: {
              code: 'PERMISSION',
              message: 'Access to this subscription host has not been granted',
              detail: 'Approve the browser permission prompt, then try again.',
            },
          };
        }
        const subscription = await services.subscriptions.add(request.url, request.name);
        const refresh = await services.subscriptions.refresh(subscription.id);
        return ok({ snapshot: await buildSnapshot(services), refresh });
      }

      case 'subscription/refresh': {
        const refresh = await services.subscriptions.refresh(request.id);
        if (refresh.ok && refresh.needsReconcile) await services.controller.reconcile();
        return ok({ snapshot: await buildSnapshot(services), refresh });
      }

      case 'subscription/remove': {
        const removed = await services.subscriptions.remove(request.id);
        if (removed.needsReconcile) await services.controller.disconnect();
        return ok(await buildSnapshot(services));
      }

      case 'diagnostics/get':
        return ok(await buildDiagnostics(services));

      case 'data/clear': {
        const db = await services.store.read();
        if (db.runtime.intent === 'on') await services.controller.disconnect();
        if (request.scope === 'profiles') {
          await services.profiles.clearAll();
        } else {
          await services.store.mutate((draft) => {
            draft.profiles = [];
            draft.subscriptions = [];
            draft.settings.activeProfileId = null;
            draft.runtime = { intent: 'off', profileId: null };
          });
        }
        return ok(await buildSnapshot(services));
      }

      default:
        return { ok: false, error: { code: 'VALIDATION', message: 'Unknown command' } };
    }
  } catch (error) {
    return { ok: false, error: toErrorPayload(error) };
  }
}
