/**
 * Plugin Manifest Schema Tests
 */

import { describe, it, expect } from '@jest/globals';
import {
  validatePluginManifest,
  safeValidatePluginManifest,
  functionalityToCapabilities,
  type PluginManifest,
} from '@/lib/json-store/schemas/plugin-manifest';

describe('Plugin Manifest Schema', () => {
  describe('validatePluginManifest', () => {
    it('should validate a minimal valid manifest', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test Plugin',
        description: 'A test plugin',
        version: '1.0.0',
        author: 'Test Author',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
      };

      const result = validatePluginManifest(manifest);
      expect(result).toBeDefined();
      expect(result.name).toBe('qtap-plugin-test');
    });

    it('should validate a complete manifest', () => {
      const manifest: PluginManifest = {
        name: 'qtap-plugin-complete',
        title: 'Complete Plugin',
        description: 'A complete plugin with all fields',
        version: '2.1.3-beta.1',
        author: {
          name: 'Test Author',
          email: 'test@example.com',
          url: 'https://example.com',
        },
        license: 'MIT',
        main: 'index.js',
        homepage: 'https://example.com/plugin',
        repository: {
          type: 'git',
          url: 'https://github.com/example/plugin.git',
        },
        compatibility: {
          quilltapVersion: '>=1.7.0',
          quilltapMaxVersion: '<=2.0.0',
          nodeVersion: '>=18.0.0',
        },
        capabilities: ['UI_COMPONENTS', 'API_ROUTES'],
        frontend: 'REACT',
        styling: 'TAILWIND',
        typescript: true,
        hooks: [
          {
            name: 'test.hook',
            handler: './hooks/test.js',
            priority: 50,
            enabled: true,
          },
        ],
        apiRoutes: [
          {
            path: '/api/test',
            methods: ['GET', 'POST'],
            handler: './routes/test.js',
            requiresAuth: true,
            description: 'Test route',
          },
        ],
        components: [
          {
            id: 'test-component',
            name: 'Test Component',
            path: './components/Test.tsx',
          },
        ],
        configSchema: [
          {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
          },
        ],
        defaultConfig: {
          apiKey: '',
        },
        permissions: {
          fileSystem: ['user-data'],
          network: ['api.example.com'],
          environment: ['API_KEY'],
          database: true,
          userData: true,
        },
        sandboxed: true,
        keywords: ['test', 'example'],
        category: 'UTILITY',
        enabledByDefault: false,
        status: 'BETA',
      };

      const result = validatePluginManifest(manifest);
      expect(result).toBeDefined();
      expect(result.capabilities).toContain('UI_COMPONENTS');
      expect(result.capabilities).toContain('API_ROUTES');
    });

    it('should reject invalid plugin name format', () => {
      const manifest = {
        name: 'invalid-plugin-name', // Must start with 'qtap-plugin-'
        title: 'Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
      };

      expect(() => validatePluginManifest(manifest)).toThrow();
    });

    it('should reject invalid version format', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test',
        description: 'Test',
        version: 'invalid-version',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
      };

      expect(() => validatePluginManifest(manifest)).toThrow();
    });

    it('should reject invalid capability', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: ['INVALID_CAPABILITY'],
      };

      expect(() => validatePluginManifest(manifest)).toThrow();
    });

    it('should reject invalid API route path', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: ['API_ROUTES'],
        apiRoutes: [
          {
            path: '/invalid-path', // Must start with /api/
            methods: ['GET'],
            handler: './handler.js',
            requiresAuth: true,
          },
        ],
      };

      expect(() => validatePluginManifest(manifest)).toThrow();
    });
  });

  describe('safeValidatePluginManifest', () => {
    it('should return success for valid manifest', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test Plugin',
        description: 'A test plugin',
        version: '1.0.0',
        author: 'Test Author',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
      };

      const result = safeValidatePluginManifest(manifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('qtap-plugin-test');
      }
    });

    it('should return error for invalid manifest', () => {
      const manifest = {
        name: 'invalid-name',
        // Missing required fields
      };

      const result = safeValidatePluginManifest(manifest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeDefined();
      }
    });
  });

  describe('functionalityToCapabilities', () => {
    it('should convert legacy functionality flags to capabilities', () => {
      const functionality = {
        providesChatCommands: true,
        providesUIComponents: true,
        providesAPIRoutes: false,
        providesDataStorage: false,
        providesAuthenticationMethods: false,
        providesWebhooks: false,
        providesBackgroundTasks: false,
        providesCustomModels: false,
        providesFileHandlers: false,
        providesNotifications: false,
        providesBackendIntegrations: false,
      };

      const capabilities = functionalityToCapabilities(functionality);
      expect(capabilities).toContain('CHAT_COMMANDS');
      expect(capabilities).toContain('UI_COMPONENTS');
      expect(capabilities).not.toContain('API_ROUTES');
      expect(capabilities.length).toBe(2);
    });

    it('should return empty array for undefined functionality', () => {
      const capabilities = functionalityToCapabilities(undefined);
      expect(capabilities).toEqual([]);
    });

    it('should return empty array when all flags are false', () => {
      const functionality = {
        providesChatCommands: false,
        providesMessageProcessors: false,
        providesUIComponents: false,
        providesDataStorage: false,
        providesAPIRoutes: false,
        providesAuthenticationMethods: false,
        providesWebhooks: false,
        providesBackgroundTasks: false,
        providesCustomModels: false,
        providesFileHandlers: false,
        providesNotifications: false,
        providesBackendIntegrations: false,
      };

      const capabilities = functionalityToCapabilities(functionality);
      expect(capabilities).toEqual([]);
    });
  });

  describe('Component ID validation', () => {
    it('should accept valid component IDs', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
        components: [
          {
            id: 'my-component',
            name: 'My Component',
            path: './Component.tsx',
          },
          {
            id: 'component123',
            name: 'Component 123',
            path: './Component123.tsx',
          },
        ],
      };

      const result = validatePluginManifest(manifest);
      expect(result).toBeDefined();
    });

    it('should reject invalid component IDs', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
        components: [
          {
            id: 'MyComponent', // Must start with lowercase
            name: 'My Component',
            path: './Component.tsx',
          },
        ],
      };

      expect(() => validatePluginManifest(manifest)).toThrow();
    });
  });

  describe('Configuration schema validation', () => {
    it('should validate various config field types', () => {
      const manifest = {
        name: 'qtap-plugin-test',
        title: 'Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        license: 'MIT',
        main: 'index.js',
        compatibility: {
          quilltapVersion: '>=1.7.0',
        },
        capabilities: [],
        configSchema: [
          {
            key: 'textField',
            label: 'Text Field',
            type: 'text',
            default: 'default',
          },
          {
            key: 'numberField',
            label: 'Number Field',
            type: 'number',
            min: 0,
            max: 100,
          },
          {
            key: 'booleanField',
            label: 'Boolean Field',
            type: 'boolean',
            default: false,
          },
          {
            key: 'selectField',
            label: 'Select Field',
            type: 'select',
            options: [
              { label: 'Option 1', value: 'opt1' },
              { label: 'Option 2', value: 'opt2' },
            ],
          },
        ],
      };

      const result = validatePluginManifest(manifest);
      expect(result).toBeDefined();
      expect(result.configSchema).toHaveLength(4);
    });
  });
});
