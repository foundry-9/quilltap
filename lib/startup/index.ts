/**
 * Startup Module Exports
 *
 * Centralized exports for all startup/initialization functionality.
 */

// Plugin initialization
export {
  initializePlugins,
  isPluginSystemInitialized,
  resetPluginSystem,
  getPluginSystemState,
  type PluginInitializationResult,
} from './plugin-initialization';
