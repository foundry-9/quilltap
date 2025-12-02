/**
 * Next.js Instrumentation
 *
 * This file is automatically run by Next.js on server startup.
 * We use it to initialize the plugin system before handling any requests.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in Node.js runtime (not Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('🚀 Server starting - initializing plugin system');

    try {
      // Dynamically import everything to avoid Edge Runtime issues
      const { initializePlugins } = await import('./lib/startup/plugin-initialization');

      const result = await initializePlugins();

      if (result.success) {
        console.log('✅ Plugin system initialized successfully', {
          total: result.stats.total,
          enabled: result.stats.enabled,
          disabled: result.stats.disabled,
          errors: result.stats.errors,
        });
      } else {
        console.error('❌ Plugin system initialization failed', {
          stats: result.stats,
          errors: result.errors,
        });
      }
    } catch (error) {
      console.error('❌ Fatal error initializing plugin system:', error);
      // Don't throw - allow server to start even if plugins fail
    }
  }
}
