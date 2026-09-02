import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashRateLimitKey } from "@/lib/request-security";
import { logServerError } from "@/lib/logger/server";

export type RateLimitRule = {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  unavailable: boolean;
  retryAfterSeconds: number;
  limitedScope?: string;
};

type ConsumeResult = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
};

function getRateLimitSecret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export async function consumeRateLimits(
  rules: RateLimitRule[],
): Promise<RateLimitDecision> {
  const supabase = createSupabaseAdminClient();
  const secret = getRateLimitSecret();

  if (!supabase || !secret) {
    return { allowed: false, unavailable: true, retryAfterSeconds: 0 };
  }

  const results = await Promise.all(
    rules.map(async (rule) => {
      const keyHash = hashRateLimitKey(rule.scope, rule.identifier, secret);
      const { data, error } = await supabase.rpc("consume_rate_limit", {
        p_scope: rule.scope,
        p_key_hash: keyHash,
        p_max_requests: rule.limit,
        p_window_seconds: rule.windowSeconds,
      });

      if (error) {
        logServerError("rate_limit_consume_error", error, {
          scope: rule.scope,
        });
        return { rule, result: null };
      }

      const result = Array.isArray(data)
        ? (data[0] as ConsumeResult | undefined)
        : (data as ConsumeResult | null);

      return { rule, result: result ?? null };
    }),
  );

  if (results.some(({ result }) => !result)) {
    return { allowed: false, unavailable: true, retryAfterSeconds: 0 };
  }

  const limited = results
    .filter(({ result }) => result && !result.allowed)
    .sort(
      (left, right) =>
        (right.result?.retry_after_seconds ?? 0) -
        (left.result?.retry_after_seconds ?? 0),
    )[0];

  if (limited?.result) {
    return {
      allowed: false,
      unavailable: false,
      retryAfterSeconds: limited.result.retry_after_seconds,
      limitedScope: limited.rule.scope,
    };
  }

  return { allowed: true, unavailable: false, retryAfterSeconds: 0 };
}

export async function resetRateLimit(scope: string, identifier: string) {
  const supabase = createSupabaseAdminClient();
  const secret = getRateLimitSecret();

  if (!supabase || !secret) {
    return false;
  }

  const keyHash = hashRateLimitKey(scope, identifier, secret);
  const { error } = await supabase.rpc("reset_rate_limit", {
    p_scope: scope,
    p_key_hash: keyHash,
  });

  if (error) {
    logServerError("rate_limit_reset_error", error, { scope });
    return false;
  }

  return true;
}
