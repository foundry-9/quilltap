/**
 * MCP Client
 *
 * Handles communication with a single MCP server using the official
 * @modelcontextprotocol/sdk. Supports both Streamable HTTP and SSE transports
 * with automatic fallback.
 *
 * In Docker (and in a self-managed VM with QUILLTAP_HOST_IP set), localhost
 * URLs need to be routed to the host machine. Unlike other providers where simple URL rewriting works, MCP
 * servers validate the HTTP Host header and reject requests from non-localhost
 * origins. We solve this with a custom fetch function that routes traffic to
 * the host gateway while preserving the original Host header.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { rewriteLocalhostUrl, createPluginLogger } from '@quilltap/plugin-utils';
import { sanitizeCustomHeaders } from './security';
import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';
import type {
  MCPServerConfig,
  MCPConnectionState,
  MCPToolDefinition,
  MCPToolCallResult,
  MCPContentBlock,
} from './types';

const clientLogger = createPluginLogger('mcp-client');

/** Hostnames that refer to the local loopback */
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Create a custom fetch function that preserves the original Host header
 * while routing traffic through the rewritten (Docker/VM gateway) hostname.
 *
 * Node.js's built-in fetch (undici) does NOT allow overriding the Host header —
 * it always uses the hostname from the URL. MCP servers validate the Host header
 * and reject requests from non-localhost origins (e.g., "host.docker.internal").
 *
 * This function uses Node.js http.request which gives full control over headers,
 * letting us route traffic to the gateway while keeping Host: localhost:PORT.
 *
 * @param targetHostname - The gateway hostname to route traffic to (e.g., "host.docker.internal")
 */
function createHostPreservingFetch(
  targetHostname: string
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());

    // Save original host for the Host header (e.g., "localhost:3030")
    const originalHost = url.host;

    // Rewrite localhost variants to the gateway hostname
    if (LOCALHOST_HOSTS.has(url.hostname)) {
      url.hostname = targetHostname;
    }

    // Build request headers from init
    const reqHeaders: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          reqHeaders[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          reqHeaders[key] = value;
        }
      } else {
        Object.assign(reqHeaders, init.headers as Record<string, string>);
      }
    }

    // Preserve the original Host header so the MCP server sees localhost
    reqHeaders['Host'] = originalHost;

    // Extract body
    let body: string | Buffer | null = null;
    if (init?.body) {
      if (typeof init.body === 'string') {
        body = init.body;
      } else if (Buffer.isBuffer(init.body)) {
        body = init.body;
      } else if (init.body instanceof ArrayBuffer) {
        body = Buffer.from(init.body);
      } else if (init.body instanceof Uint8Array) {
        body = Buffer.from(init.body);
      }
    }

    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    return new Promise<Response>((resolve, reject) => {
      const req = httpModule.request(
        {
          hostname: url.hostname,
          port: parseInt(url.port) || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: init?.method || 'GET',
          headers: reqHeaders,
        },
        (res) => {
          // Convert Node.js IncomingMessage to web ReadableStream
          const webStream = Readable.toWeb(
            res as unknown as Readable
          ) as ReadableStream<Uint8Array>;

          // Build response headers
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) {
              if (Array.isArray(value)) {
                for (const v of value) {
                  responseHeaders.append(key, v);
                }
              } else {
                responseHeaders.set(key, value);
              }
            }
          }

          resolve(
            new Response(webStream, {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? '',
              headers: responseHeaders,
            })
          );
        }
      );

      req.on('error', reject);

      // Handle abort signal
      if (init?.signal) {
        if (init.signal.aborted) {
          req.destroy();
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        init.signal.addEventListener('abort', () => {
          req.destroy();
        });
      }

      if (body) {
        req.write(body);
      }
      req.end();
    });
  };
}

/**
 * MCP Client for a single server
 *
 * Uses the official MCP SDK for protocol handling.
 */
export class MCPClient {
  private config: MCPServerConfig;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private state: MCPConnectionState;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.state = {
      serverId: config.name,
      status: 'disconnected',
      tools: [],
      reconnectAttempts: 0,
    };
  }

  /**
   * Get current connection state
   */
  getState(): MCPConnectionState {
    return { ...this.state };
  }

  /**
   * Get discovered tools
   */
  getTools(): MCPToolDefinition[] {
    return [...this.state.tools];
  }

  /**
   * Get server configuration
   */
  getConfig(): MCPServerConfig {
    return { ...this.config };
  }

  /**
   * Build request headers for the MCP server
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    // Add auth headers based on config
    switch (this.config.authType) {
      case 'bearer':
        if (this.config.bearerToken) {
          headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
        }
        break;

      case 'api-key':
        if (this.config.apiKey) {
          const headerName = this.config.apiKeyHeader || 'X-API-Key';
          headers[headerName] = this.config.apiKey;
        }
        break;

      case 'custom-header':
        if (this.config.customHeaders) {
          const customHeaders = sanitizeCustomHeaders(this.config.customHeaders);
          if (customHeaders) {
            Object.assign(headers, customHeaders);
          }
        }
        break;
    }

    return headers;
  }

  /**
   * Connect to the MCP server
   *
   * Tries Streamable HTTP first, then falls back to SSE if that fails.
   *
   * In container environments, we provide a custom fetch function to the
   * MCP SDK transports that routes traffic to the host gateway while
   * preserving the original Host header (which MCP servers validate).
   */
  async connect(): Promise<void> {
    if (this.state.status === 'connected' || this.state.status === 'ready') {
      return;
    }

    this.state.status = 'connecting';
    const originalUrl = this.config.url;
    const resolvedUrl = rewriteLocalhostUrl(originalUrl);
    const wasRewritten = resolvedUrl !== originalUrl;

    clientLogger.debug('Connecting to MCP server', {
      serverId: this.config.name,
      originalUrl,
      resolvedUrl,
      wasRewritten,
    });

    // Use the ORIGINAL URL for the SDK transports — this preserves the
    // correct Host header (e.g., "localhost:3030"). If the URL was rewritten,
    // we provide a custom fetch that routes to the gateway while keeping the
    // original Host header intact.
    const url = new URL(originalUrl);
    const headers = this.buildHeaders();

    // Create a custom fetch for VM environments that preserves the Host header
    let customFetch: ((url: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
    if (wasRewritten) {
      const resolvedParsed = new URL(resolvedUrl);
      customFetch = createHostPreservingFetch(resolvedParsed.hostname);
      clientLogger.info('Using host-preserving fetch for VM environment', {
        serverId: this.config.name,
        targetHostname: resolvedParsed.hostname,
        originalHost: url.host,
      });
    }

    try {
      // Try Streamable HTTP first (newer protocol)
      try {
        this.client = new Client(
          { name: 'quilltap', version: '1.0.0' },
          { capabilities: {} }
        );

        this.transport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers,
          },
          fetch: customFetch,
        });

        await this.client.connect(this.transport);

        clientLogger.debug('Connected via Streamable HTTP', {
          serverId: this.config.name,
        });
      } catch (streamableError) {
        // Fall back to SSE transport
        clientLogger.debug('Streamable HTTP failed, falling back to SSE', {
          serverId: this.config.name,
          error: streamableError instanceof Error ? streamableError.message : String(streamableError),
        });

        // Close any partial connection
        if (this.transport) {
          try {
            await this.transport.close();
          } catch {
            // Ignore close errors
          }
        }

        this.client = new Client(
          { name: 'quilltap', version: '1.0.0' },
          { capabilities: {} }
        );

        // SSEClientTransport takes URL and optional options
        this.transport = new SSEClientTransport(url, {
          requestInit: {
            headers,
          },
          fetch: customFetch,
        });

        await this.client.connect(this.transport);

        clientLogger.debug('Connected via SSE', {
          serverId: this.config.name,
        });
      }

      this.state.status = 'connected';
      this.state.lastConnected = new Date();
      this.state.reconnectAttempts = 0;

    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Connection failed';

      clientLogger.error('Failed to connect to MCP server', {
        serverId: this.config.name,
        error: this.state.lastError,
      });

      throw error;
    }
  }

  /**
   * Discover tools from the MCP server
   */
  async discoverTools(): Promise<MCPToolDefinition[]> {
    if (!this.client) {
      throw new Error('Not connected');
    }

    if (this.state.status !== 'connected' && this.state.status !== 'ready') {
      throw new Error(`Cannot discover tools (status: ${this.state.status})`);
    }

    this.state.status = 'discovering';

    try {
      const result = await this.client.listTools();

      // Convert SDK tool format to our MCPToolDefinition format
      this.state.tools = (result.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as MCPToolDefinition['inputSchema'],
      }));

      this.state.status = 'ready';

      return this.state.tools;
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Tool discovery failed';

      clientLogger.error('Tool discovery failed', {
        serverId: this.config.name,
        error: this.state.lastError,
      });

      throw error;
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    if (!this.client) {
      throw new Error('Not connected');
    }

    if (this.state.status !== 'ready') {
      throw new Error(`Server not ready (status: ${this.state.status})`);
    }

    const result = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    // Type definition for SDK content blocks
    interface SDKContentBlock {
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }

    // Convert SDK result to our MCPToolCallResult format
    const sdkContent = (result.content || []) as SDKContentBlock[];
    const content: MCPContentBlock[] = sdkContent.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      } else if (block.type === 'image') {
        return {
          type: 'image' as const,
          data: block.data,
          mimeType: block.mimeType,
        };
      } else if (block.type === 'resource') {
        return {
          type: 'resource' as const,
          // Resource blocks have different structure
          text: JSON.stringify(block),
        };
      }
      // Unknown type, convert to text
      return { type: 'text' as const, text: JSON.stringify(block) };
    });

    const mcpResult: MCPToolCallResult = {
      content,
      isError: result.isError === true,
    };

    return mcpResult;
  }

  /**
   * Reconnect to the MCP server
   *
   * Disconnects, reconnects, and rediscovers tools. Used when the server
   * session has gone stale (e.g., "Server not initialized" error from
   * Streamable HTTP after server restart or session expiry).
   */
  async reconnect(): Promise<void> {
    clientLogger.info('Reconnecting to MCP server', {
      serverId: this.config.name,
      previousStatus: this.state.status,
    });

    await this.disconnect();
    await this.connect();
    await this.discoverTools();

    clientLogger.info('Successfully reconnected to MCP server', {
      serverId: this.config.name,
      toolCount: this.state.tools.length,
    });
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        clientLogger.warn('Error closing transport', {
          serverId: this.config.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.client = null;
    this.transport = null;
    this.state.status = 'disconnected';
    this.state.tools = [];
  }

  /**
   * Check if connected and ready
   */
  isReady(): boolean {
    return this.state.status === 'ready';
  }

  /**
   * Check if connected (but not necessarily ready)
   */
  isConnected(): boolean {
    return (
      this.state.status === 'connected' ||
      this.state.status === 'discovering' ||
      this.state.status === 'ready'
    );
  }
}
