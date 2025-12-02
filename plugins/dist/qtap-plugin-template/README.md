# Quilltap Plugin Template

A comprehensive template plugin for Quilltap demonstrating all available plugin capabilities and configuration options using ES Modules (ESM).

## Overview

This template provides a working example of a Quilltap plugin with:

- ✅ ESM (ECMAScript Modules) support
- ✅ API route handlers
- ✅ Plugin lifecycle management (initialization and cleanup)
- ✅ Configuration schema
- ✅ Type-safe manifest
- ✅ Security permissions

## Plugin Structure

```
qtap-plugin-template/
├── index.js                 # Main entry point with initialization
├── exampleHandler.js        # Example API route handler
├── manifest.json            # Plugin manifest (metadata and configuration)
├── package.json             # NPM package configuration (ESM)
├── schemas/
│   └── plugin-manifest.schema.json
└── README.md                # This file
```

## Quick Start

### 1. Installation

This plugin ships with Quilltap and is located in `plugins/dist/qtap-plugin-template/`.

To create your own plugin based on this template:

```bash
# Copy the template
cp -r plugins/dist/qtap-plugin-template plugins/my-awesome-plugin

# Update the plugin details
cd plugins/my-awesome-plugin
# Edit manifest.json and package.json with your plugin details
```

### 2. Configuration

Edit the `manifest.json` file to configure your plugin:

```json
{
  "name": "my-awesome-plugin",
  "title": "My Awesome Plugin",
  "description": "Description of what your plugin does",
  "version": "1.0.0",
  "capabilities": ["API_ROUTES"],
  "enabledByDefault": false
}
```

### 3. Enable the Plugin

Plugins can be enabled through the Quilltap admin interface or by setting `enabledByDefault: true` in the manifest.

## Using ESM

This plugin uses **ES Modules (ESM)**, which is the modern JavaScript module system. Key points:

### Package Configuration

The `package.json` specifies ESM with:

```json
{
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js"
  }
}
```

### Import/Export Syntax

Use ESM import/export syntax in all `.js` files:

```javascript
// Export functions
export async function GET(request, context) {
  // handler code
}

// Import from other modules
import { something } from './other-module.js';

// Always include .js extension in imports!
export * from './exampleHandler.js';
```

### Important ESM Rules

1. **Always use `.js` extensions** in import statements (even for files you create)
2. Use `import` and `export`, not `require()` or `module.exports`
3. Top-level `await` is supported
4. `__dirname` and `__filename` are not available (use `import.meta.url` instead)

## API Route Handlers

API route handlers use Next.js-style route handlers with ESM:

```javascript
/**
 * GET handler
 */
export async function GET(request, context) {
  // Access plugin configuration
  const config = context?.pluginConfig || {};

  // Check authentication
  if (!context?.session) {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Return response
  return new Response(
    JSON.stringify({ success: true, data: 'your data here' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * POST handler
 */
export async function POST(request, context) {
  const body = await request.json();
  // Handle POST request
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

## Plugin Lifecycle

### Initialization

The `initialize` function in `index.js` is called when the plugin loads:

```javascript
export async function initialize(context) {
  const { config, logger } = context;

  logger?.info('Plugin starting up');

  // Set up your plugin here:
  // - Database connections
  // - Event listeners
  // - Third-party services
}
```

### Cleanup

The `cleanup` function is called when the plugin is unloaded:

```javascript
export async function cleanup(context) {
  const { logger } = context;

  logger?.info('Plugin shutting down');

  // Clean up resources:
  // - Close connections
  // - Remove listeners
  // - Save state
}
```

## Configuration Schema

Define user-configurable settings in `manifest.json`:

```json
{
  "configSchema": [
    {
      "key": "exampleSetting",
      "label": "Example Setting",
      "type": "text",
      "default": "default value",
      "required": false,
      "description": "Description shown to users"
    }
  ],
  "defaultConfig": {
    "exampleSetting": "default value"
  }
}
```

Access configuration in handlers:

```javascript
export async function GET(request, context) {
  const setting = context?.pluginConfig?.exampleSetting;
  // Use the setting
}
```

## Manifest Reference

Key manifest properties:

- **name**: Unique plugin identifier (kebab-case)
- **title**: Human-readable plugin name
- **version**: Semantic version (1.0.0)
- **capabilities**: Array of plugin capabilities (`["API_ROUTES"]`, `["UI_COMPONENTS"]`, etc.)
- **apiRoutes**: Array of API route definitions
- **permissions**: Security permissions the plugin needs
- **sandboxed**: Whether the plugin runs in a sandbox
- **enabledByDefault**: Auto-enable on installation

## Security & Permissions

Request only the permissions your plugin needs:

```json
{
  "permissions": {
    "fileSystem": [],        // File paths plugin can access
    "network": [],           // Domains plugin can call
    "environment": [],       // Environment variables
    "database": false,       // Database access
    "userData": false        // User data access
  },
  "sandboxed": true          // Run in sandbox for safety
}
```

## Testing Your Plugin

1. Place your plugin in `plugins/` directory
2. Start Quilltap in development mode: `npm run dev`
3. Check logs for plugin loading messages
4. Test your API routes: `curl http://localhost:3000/api/example`
5. Enable debug logging in Quilltap settings

## Best Practices

1. **Use ESM everywhere**: All plugin code should use ESM syntax
2. **Include file extensions**: Always use `.js` in import statements
3. **Validate inputs**: Never trust user input
4. **Handle errors**: Use try/catch and return proper error responses
5. **Log appropriately**: Use the provided logger for debugging
6. **Document your code**: Add JSDoc comments for maintainability
7. **Request minimal permissions**: Only ask for what you need
8. **Test thoroughly**: Test all API routes and edge cases

## Testing the Plugin System

### Testing Dynamic Route Loading

To test that plugin routes are properly loaded and unloaded:

```bash
# 1. Start the Quilltap application in development mode
npm run dev

# 2. Enable the template plugin
curl -X PUT http://localhost:3000/api/plugins/qtap-plugin-template \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Response should show:
# {
#   "success": true,
#   "plugin": { "name": "qtap-plugin-template", "enabled": true, ... },
#   "routesRefreshed": true
# }

# 3. Test the plugin route (requires authentication - login first via browser)
curl http://localhost:3000/api/plugin-routes/example \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"

# Response should be:
# {
#   "success": true,
#   "message": "Hello from qtap-plugin-template!",
#   "timestamp": "2024-..."
# }

# 4. Disable the plugin
curl -X PUT http://localhost:3000/api/plugins/qtap-plugin-template \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# 5. Route should now return 404 (Not Found)
curl http://localhost:3000/api/plugin-routes/example

# Response should be:
# {
#   "error": "Not Found",
#   "message": "No plugin route found for GET /api/example"
# }
```

### Getting Your Session Token

To test authenticated routes, you need a session token:

1. Open your browser and log in to Quilltap
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies
4. Find `next-auth.session-token` and copy its value
5. Use it in your curl commands

### Testing Without Authentication

To test without authentication, temporarily set `requiresAuth: false` in the manifest:

```json
{
  "apiRoutes": [
    {
      "path": "/api/example",
      "handler": "exampleHandler.js",
      "methods": ["GET", "POST"],
      "requiresAuth": false  // Temporarily disable auth for testing
    }
  ]
}
```

Remember to set it back to `true` for production!

### Checking Plugin Status

```bash
# List all registered plugins
curl http://localhost:3000/api/plugins

# Check logs for detailed plugin initialization
# Look for log entries like:
# - "Plugin system initialized"
# - "Plugin routes registered"
# - "Plugin status updated"
```

## Troubleshooting

### "Cannot use import statement outside a module"

Make sure `package.json` has `"type": "module"`.

### "Module not found"

Check that you're using `.js` extensions in import statements:
```javascript
// Correct
import { something } from './module.js';

// Wrong
import { something } from './module';
```

### Plugin not loading

Check the Quilltap logs for errors. Common issues:
- Invalid manifest.json
- Missing required fields
- Handler files not found
- Syntax errors in JavaScript

### Routes not registering

If your plugin is enabled but routes aren't working:

1. Check that `capabilities` includes `"API_ROUTES"`
2. Verify the handler file exists at the specified path
3. Check logs for "Plugin routes registered" message
4. Ensure the path in `apiRoutes` matches your test URL
5. Remember: `/api/example` is accessed via `/api/plugin-routes/example`

### Routes not refreshing on enable/disable

This should happen automatically. Check logs for:

- "Refreshing plugin routes after status change"
- "Plugin routes refreshed"

If missing, the plugin may not have `API_ROUTES` capability.

## Contributing

To contribute improvements to this template:

1. Fork the Quilltap repository
2. Make your changes
3. Submit a pull request

## License

MIT License - See the LICENSE file in the Quilltap repository.

## Support

- **Documentation**: https://github.com/foundry-9/quilltap
- **Issues**: https://github.com/foundry-9/quilltap/issues
- **Email**: charles@sebold.tech
