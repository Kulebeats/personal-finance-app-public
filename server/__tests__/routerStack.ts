type RoutePath = string | RegExp | Array<string | RegExp>;

type RouteLayer = {
  handle?: unknown;
  route?: {
    path: RoutePath;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle?: unknown }>;
  };
};

type RouterWithStack = {
  stack?: RouteLayer[];
};

function getStack(router: unknown): RouteLayer[] {
  return (router as RouterWithStack).stack ?? [];
}

function matchesPath(actual: RoutePath, expected: string): boolean {
  if (Array.isArray(actual)) {
    return actual.some((path) => matchesPath(path, expected));
  }

  if (typeof actual === "string") {
    return actual === expected;
  }

  return actual.test(expected);
}

export function routerUsesMiddlewareBeforeRoutes(
  router: unknown,
  middleware: unknown,
): boolean {
  const stack = getStack(router);
  const middlewareIndex = stack.findIndex(
    (layer) => !layer.route && layer.handle === middleware,
  );
  const firstRouteIndex = stack.findIndex((layer) => Boolean(layer.route));

  return (
    middlewareIndex >= 0 &&
    (firstRouteIndex === -1 || middlewareIndex < firstRouteIndex)
  );
}

export function routeUsesMiddleware(
  router: unknown,
  path: string,
  method: string,
  middleware: unknown,
): boolean {
  const normalizedMethod = method.toLowerCase();

  return getStack(router).some((layer) => {
    const route = layer.route;

    if (!route || !matchesPath(route.path, path)) {
      return false;
    }

    if (!route.methods?.[normalizedMethod]) {
      return false;
    }

    return (
      route.stack?.some((routeLayer) => routeLayer.handle === middleware) ??
      false
    );
  });
}
