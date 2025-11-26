/**
 * Centralized configuration for UI route capabilities (e.g., debug support).
 * This allows components like the nav bar to check whether a route should
 * expose optional controls without hardcoding path checks all over the app.
 */

type RouteFlagDefinition = {
  pattern: RegExp;
  supportsDebug?: boolean;
};

type RouteFlagResult = {
  supportsDebug: boolean;
};

const DEFAULT_FLAGS: RouteFlagResult = {
  supportsDebug: false,
};

// Ordered list so later definitions can override earlier ones if needed.
const ROUTE_FLAGS: RouteFlagDefinition[] = [
  {
    // Chat conversation pages currently are the only routes that expose the debug panel.
    pattern: /^\/chats\/[^/]+$/,
    supportsDebug: true,
  },
];

/**
 * Returns the resolved flags for a route path (defaults to no capabilities).
 */
export function getRouteFlags(pathname?: string | null): RouteFlagResult {
  if (!pathname) {
    return DEFAULT_FLAGS;
  }

  for (const definition of ROUTE_FLAGS) {
    if (definition.pattern.test(pathname)) {
      return {
        supportsDebug: Boolean(definition.supportsDebug),
      };
    }
  }

  return DEFAULT_FLAGS;
}

/**
 * Convenience helper specifically for checking debug support.
 */
export function routeSupportsDebug(pathname?: string | null): boolean {
  return getRouteFlags(pathname).supportsDebug;
}
