"use client";

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

export type DebugEntryDirection = 'outgoing' | 'incoming';
export type DebugEntryStatus = 'pending' | 'streaming' | 'complete' | 'error';

// Supported LLM provider types for icons
export type LLMProviderType =
  | 'ANTHROPIC'
  | 'OPENAI'
  | 'OPENROUTER'
  | 'GROK'
  | 'OLLAMA'
  | 'OPENAI_COMPATIBLE'
  | 'GOOGLE'
  | 'GAB_AI'
  | 'UNKNOWN';

export interface DebugEntry {
  id: string;
  timestamp: Date;
  direction: DebugEntryDirection;
  // Display name (e.g., connection profile name)
  provider: string;
  // Provider type for icon display
  providerType?: LLMProviderType;
  // Model name
  model?: string;
  endpoint?: string;
  status: DebugEntryStatus;
  data: string;
  rawData?: unknown;
  contentType?: string;
  error?: string;
  // For streaming responses, the stitched content after completion
  stitchedContent?: string;
  // Metadata extracted from the final response
  finalMetadata?: {
    messageId?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    toolsExecuted?: boolean;
    toolsDetected?: number;
  };
  // The final SSE event (done: true) without content, for display
  finalEvent?: Record<string, unknown>;
  // LLM request details (from server debug event)
  llmRequestDetails?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    messageCount?: number;
    hasTools?: boolean;
    tools?: unknown[];
    messages?: Array<{ role: string; contentLength: number; hasAttachments?: boolean }>;
    // Context management info (Sprint 5)
    contextManagement?: {
      tokenUsage: {
        systemPrompt: number;
        memories: number;
        summary: number;
        recentMessages: number;
        total: number;
      };
      budget: {
        total: number;
        responseReserve: number;
      };
      memoriesIncluded: number;
      messagesIncluded: number;
      messagesTruncated: boolean;
      includedSummary: boolean;
      // Debug content for viewing
      debugMemories?: Array<{ summary: string; importance: number; score: number }>;
      debugSummary?: string;
      debugSystemPrompt?: string;
    };
  };
  // Memory extraction debug logs (Sprint 6)
  debugMemoryLogs?: string[];
}

interface DebugContextValue {
  isDebugMode: boolean;
  toggleDebugMode: () => void;
  entries: DebugEntry[];
  addEntry: (entry: Omit<DebugEntry, 'id' | 'timestamp'>) => string;
  updateEntry: (id: string, updates: Partial<DebugEntry>) => void;
  appendToEntry: (id: string, chunk: string) => void;
  finalizeStreamingEntry: (id: string) => void;
  clearEntries: () => void;
}

const DebugContext = createContext<DebugContextValue | null>(null);

export function useDebug() {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return context;
}

export function useDebugOptional() {
  return useContext(DebugContext);
}

// Mask API keys and sensitive data
export function maskSensitiveData(data: string): string {
  // Mask Bearer tokens
  let masked = data.replace(
    /(Bearer\s+)([A-Za-z0-9_-]{10,})/gi,
    '$1***MASKED***'
  );

  // Mask API keys in various formats
  masked = masked.replace(
    /(["']?(?:api[_-]?key|apikey|authorization|x-api-key|openai-api-key|anthropic-api-key)["']?\s*[:=]\s*["']?)([A-Za-z0-9_-]{20,})(["']?)/gi,
    '$1***MASKED***$3'
  );

  // Mask sk- prefixed keys (OpenAI)
  masked = masked.replace(
    /(sk-[A-Za-z0-9]{10,})/g,
    '***MASKED-SK***'
  );

  // Mask anthropic keys
  masked = masked.replace(
    /(sk-ant-[A-Za-z0-9]{10,})/g,
    '***MASKED-ANT***'
  );

  return masked;
}

// Hide large binary data
export function hideBinaryData(data: string): string {
  // Hide base64 encoded images (long base64 strings)
  let processed = data.replace(
    /("data"\s*:\s*")([A-Za-z0-9+/]{500,}={0,2})(")/g,
    '$1[BINARY DATA: ~' + Math.round(data.length / 1333) + ' KB]$3'
  );

  // Hide data URLs
  processed = processed.replace(
    /(data:image\/[a-z]+;base64,)([A-Za-z0-9+/]{100,}={0,2})/g,
    (match, prefix) => `${prefix}[BINARY DATA HIDDEN]`
  );

  return processed;
}

// Pretty print JSON
export function formatData(data: string, contentType?: string): string {
  const masked = maskSensitiveData(data);
  const hiddenBinary = hideBinaryData(masked);

  // Try to parse and pretty-print JSON
  if (!contentType || contentType.includes('json')) {
    try {
      const parsed = JSON.parse(hiddenBinary);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, return as-is
    }
  }

  // Try to format XML
  if (contentType?.includes('xml')) {
    try {
      return formatXML(hiddenBinary);
    } catch {
      // Not valid XML, return as-is
    }
  }

  return hiddenBinary;
}

function formatXML(xml: string): string {
  let formatted = '';
  let indent = 0;
  const tab = '  ';

  xml.split(/>\s*</).forEach((node, index) => {
    if (node.match(/^\/\w/)) {
      indent--;
    }
    formatted += (index > 0 ? '\n' : '') + tab.repeat(indent) + (index > 0 ? '<' : '') + node + (index < xml.split(/>\s*</).length - 1 ? '>' : '');
    if (node.match(/^<?\w[^>]*[^/]$/) && !node.startsWith('?')) {
      indent++;
    }
  });

  return formatted;
}

// Parse SSE data and extract all content chunks plus metadata
function parseSSEAndStitchContent(rawData: string): {
  stitchedContent: string;
  finalMetadata: DebugEntry['finalMetadata'];
  llmRequestDetails: DebugEntry['llmRequestDetails'];
  finalEvent: DebugEntry['finalEvent'];
  debugMemoryLogs?: string[];
} {
  const lines = rawData.split('\n');
  let stitchedContent = '';
  const finalMetadata: DebugEntry['finalMetadata'] = {};
  let llmRequestDetails: DebugEntry['llmRequestDetails'] = undefined;
  let finalEvent: DebugEntry['finalEvent'] = undefined;
  let debugMemoryLogs: string[] | undefined = undefined;

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));

        // Capture LLM request debug info
        if (data.debugLLMRequest) {
          llmRequestDetails = data.debugLLMRequest;
        }

        // Capture memory debug logs
        if (data.debugMemoryLogs && Array.isArray(data.debugMemoryLogs)) {
          debugMemoryLogs = data.debugMemoryLogs;
        }

        // Stitch content together
        if (data.content) {
          stitchedContent += data.content;
        }

        // Capture metadata from various events
        if (data.toolsDetected) {
          finalMetadata.toolsDetected = data.toolsDetected;
        }

        if (data.done) {
          finalMetadata.messageId = data.messageId;
          finalMetadata.toolsExecuted = data.toolsExecuted;
          if (data.usage) {
            finalMetadata.usage = data.usage;
          }
          // Capture the final event (without content) for display
          finalEvent = { ...data };
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  }

  return { stitchedContent, finalMetadata, llmRequestDetails, finalEvent, debugMemoryLogs };
}

let entryIdCounter = 0;

export function DebugProvider({ children }: { children: ReactNode }) {
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const entriesRef = useRef<DebugEntry[]>([]);

  const toggleDebugMode = useCallback(() => {
    setIsDebugMode(prev => !prev);
  }, []);

  const addEntry = useCallback((entry: Omit<DebugEntry, 'id' | 'timestamp'>): string => {
    const id = `debug-${++entryIdCounter}-${Date.now()}`;
    const newEntry: DebugEntry = {
      ...entry,
      id,
      timestamp: new Date(),
    };
    entriesRef.current = [...entriesRef.current, newEntry];
    setEntries(entriesRef.current);
    return id;
  }, []);

  const updateEntry = useCallback((id: string, updates: Partial<DebugEntry>) => {
    entriesRef.current = entriesRef.current.map(entry =>
      entry.id === id ? { ...entry, ...updates } : entry
    );
    setEntries([...entriesRef.current]);
  }, []);

  const appendToEntry = useCallback((id: string, chunk: string) => {
    entriesRef.current = entriesRef.current.map(entry =>
      entry.id === id ? { ...entry, data: entry.data + chunk } : entry
    );
    setEntries([...entriesRef.current]);
  }, []);

  const finalizeStreamingEntry = useCallback((id: string) => {
    entriesRef.current = entriesRef.current.map(entry => {
      if (entry.id === id && entry.contentType === 'text/event-stream') {
        const { stitchedContent, finalMetadata, llmRequestDetails, finalEvent, debugMemoryLogs } = parseSSEAndStitchContent(entry.data);
        return {
          ...entry,
          status: 'complete' as const,
          stitchedContent,
          finalMetadata,
          llmRequestDetails,
          finalEvent,
          debugMemoryLogs,
        };
      }
      return entry;
    });
    setEntries([...entriesRef.current]);
  }, []);

  const clearEntries = useCallback(() => {
    entriesRef.current = [];
    setEntries([]);
  }, []);

  return (
    <DebugContext.Provider
      value={{
        isDebugMode,
        toggleDebugMode,
        entries,
        addEntry,
        updateEntry,
        appendToEntry,
        finalizeStreamingEntry,
        clearEntries,
      }}
    >
      {children}
    </DebugContext.Provider>
  );
}
