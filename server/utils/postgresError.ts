export interface PostgresErrorLike {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

const MAX_CAUSE_DEPTH = 4;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/i;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function readProperty(value: object, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

/**
 * Normalize direct node-postgres errors and errors wrapped by query builders.
 * The bounded, cycle-aware cause walk avoids treating arbitrary nested values
 * as database failures while preserving PostgreSQL SQLSTATE/constraint data.
 */
export function getPostgresError(
  error: unknown,
): PostgresErrorLike | undefined {
  const seen = new Set<object>();
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!isObject(current) || seen.has(current)) {
      return undefined;
    }
    seen.add(current);

    const code = readProperty(current, "code");
    if (typeof code === "string" && SQLSTATE_PATTERN.test(code)) {
      return current as PostgresErrorLike;
    }

    current = readProperty(current, "cause");
  }

  return undefined;
}

export function isPostgresError(
  error: unknown,
  code: string,
  constraintFragment?: string,
): boolean {
  const pgError = getPostgresError(error);
  if (!pgError || pgError.code !== code) {
    return false;
  }

  return (
    constraintFragment === undefined ||
    (typeof pgError.constraint === "string" &&
      pgError.constraint.includes(constraintFragment))
  );
}
