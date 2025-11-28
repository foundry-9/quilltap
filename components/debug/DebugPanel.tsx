"use client";

import { useEffect, useRef, useState } from 'react';
import { useDebug, formatData, DebugEntry, LLMProviderType } from '@/components/providers/debug-provider';

// Copy button component
function CopyButton({ content }: Readonly<{ content: string }>) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 text-xs rounded transition-colors whitespace-nowrap cursor-pointer"
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      style={{
        backgroundColor: copied ? '#10b981' : '#e5e7eb',
        color: copied ? '#fff' : '#4b5563',
      }}
    >
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  );
}

// Provider icons as simple SVG components
function ProviderIcon({ type, className = "w-4 h-4" }: { type?: LLMProviderType; className?: string }) {
  switch (type) {
    case 'ANTHROPIC':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.304 3.541l-5.296 16.918H8.399L3.104 3.541h3.625l3.674 12.174 3.674-12.174h3.227zm3.592 0l3.104 16.918h-3.227l-3.104-16.918h3.227z"/>
        </svg>
      );
    case 'OPENAI':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      );
    case 'GROK':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      );
    case 'GOOGLE':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
      );
    case 'OLLAMA':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="currentColor" fill="none"/>
          <circle cx="12" cy="12" r="4" fill="currentColor"/>
        </svg>
      );
    case 'OPENROUTER':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    default:
      // Generic AI/bot icon for unknown providers
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <circle cx="9" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="15" cy="10" r="1.5" fill="currentColor"/>
          <path d="M9 15h6" strokeLinecap="round"/>
        </svg>
      );
  }
}

// Simple syntax highlighting for JSON
function SyntaxHighlightedJSON({ content }: { content: string }) {
  const highlighted = content
    // Strings
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="text-purple-600 dark:text-purple-400">$1</span>:'
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="text-green-600 dark:text-green-400">$1</span>'
    )
    // Numbers
    .replace(
      /:\s*(-?\d+\.?\d*)/g,
      ': <span class="text-blue-600 dark:text-blue-400">$1</span>'
    )
    // Booleans and null
    .replace(
      /:\s*(true|false|null)/g,
      ': <span class="text-orange-600 dark:text-orange-400">$1</span>'
    );

  return (
    <pre
      className="whitespace-pre-wrap break-all text-xs"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

function DebugEntryCard({ entry }: { entry: DebugEntry }) {
  const isOutgoing = entry.direction === 'outgoing';
  const formattedData = formatData(entry.data, entry.contentType);
  const hasStitchedContent = entry.stitchedContent !== undefined && entry.stitchedContent.length > 0;

  const statusColors = {
    pending: 'bg-yellow-500',
    streaming: 'bg-blue-500 animate-pulse',
    complete: 'bg-green-500',
    error: 'bg-red-500',
  };

  const directionColors = {
    outgoing: 'border-l-blue-500 bg-blue-50 dark:bg-blue-950/30',
    incoming: 'border-l-green-500 bg-green-50 dark:bg-green-950/30',
  };

  return (
    <div
      className={`border-l-4 ${directionColors[entry.direction]} rounded-r mb-2 overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${statusColors[entry.status]}`}
            title={entry.status}
          />
          <span className={`text-xs font-semibold ${isOutgoing ? 'text-blue-700 dark:text-blue-400' : 'text-green-700 dark:text-green-400'}`}>
            {isOutgoing ? '→ OUT' : '← IN'}
          </span>
          {/* Provider badge with icon */}
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded text-xs font-medium text-gray-700 dark:text-gray-300"
            title={`Provider: ${entry.providerType || 'Unknown'}${entry.model ? `\nModel: ${entry.model}` : ''}`}
          >
            <ProviderIcon type={entry.providerType} className="w-3 h-3" />
            {entry.provider}
          </span>
          {entry.model && (
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]" title={entry.model}>
              {entry.model}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {entry.timestamp.toLocaleTimeString()}
        </span>
      </div>

      {/* LLM Request Details (shown for incoming responses with debug info) */}
      {entry.llmRequestDetails && (
        <details className="border-b border-cyan-200 dark:border-cyan-800 group/details [&[open]>summary>svg.chevron]:rotate-90">
          <summary className="px-3 py-2 text-xs cursor-pointer select-none bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 flex items-center gap-1 group">
            <svg className="chevron w-3 h-3 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">LLM Request Details</span>
            {entry.llmRequestDetails.hasTools && (
              <span className="ml-2 px-1.5 py-0.5 bg-purple-200 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded text-xs">
                Has Tools
              </span>
            )}
            <span className="ml-auto text-cyan-600 dark:text-cyan-500">
              {entry.llmRequestDetails.messageCount} messages
            </span>
            <div className="opacity-0 group-hover:opacity-100 group-hover/details:opacity-100 transition-opacity">
              <CopyButton content={JSON.stringify(entry.llmRequestDetails, null, 2)} />
            </div>
          </summary>
          <div className="p-3 bg-cyan-50/50 dark:bg-cyan-950/20 group-hover/details:flex group-hover/details:flex-col">
            {/* Request parameters */}
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded">
                temp: {entry.llmRequestDetails.temperature ?? 'default'}
              </span>
              <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded">
                maxTokens: {entry.llmRequestDetails.maxTokens ?? 'default'}
              </span>
              {entry.llmRequestDetails.topP !== undefined && (
                <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded">
                  topP: {entry.llmRequestDetails.topP}
                </span>
              )}
            </div>
            {/* Message summary */}
            {entry.llmRequestDetails.messages && (
              <div className="mb-2">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Messages:</div>
                <div className="flex flex-wrap gap-1">
                  {entry.llmRequestDetails.messages.map((msg, idx) => (
                    <span
                      key={idx}
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        msg.role === 'system' ? 'bg-yellow-200 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300' :
                        msg.role === 'user' ? 'bg-blue-200 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300' :
                        'bg-green-200 dark:bg-green-900/50 text-green-800 dark:text-green-300'
                      }`}
                    >
                      {msg.role} ({msg.contentLength} chars){msg.hasAttachments ? ' +files' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Context Management Info */}
            {entry.llmRequestDetails.contextManagement && (
              <div className="mb-2 p-2 bg-violet-50 dark:bg-violet-950/30 rounded border border-violet-200 dark:border-violet-800">
                <div className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-2 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"/>
                  </svg>
                  Context Management
                </div>
                {/* Token usage breakdown */}
                <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">System Prompt:</span>
                    <span className="font-mono text-violet-600 dark:text-violet-400">
                      {entry.llmRequestDetails.contextManagement.tokenUsage.systemPrompt.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Memories:</span>
                    <span className="font-mono text-violet-600 dark:text-violet-400">
                      {entry.llmRequestDetails.contextManagement.tokenUsage.memories.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Summary:</span>
                    <span className="font-mono text-violet-600 dark:text-violet-400">
                      {entry.llmRequestDetails.contextManagement.tokenUsage.summary.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Messages:</span>
                    <span className="font-mono text-violet-600 dark:text-violet-400">
                      {entry.llmRequestDetails.contextManagement.tokenUsage.recentMessages.toLocaleString()}
                    </span>
                  </div>
                </div>
                {/* Total usage bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 dark:text-gray-400">
                      Total: {entry.llmRequestDetails.contextManagement.tokenUsage.total.toLocaleString()} / {entry.llmRequestDetails.contextManagement.budget.total.toLocaleString()}
                    </span>
                    <span className="font-semibold text-violet-700 dark:text-violet-400">
                      {Math.round((entry.llmRequestDetails.contextManagement.tokenUsage.total / entry.llmRequestDetails.contextManagement.budget.total) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all"
                      style={{
                        width: `${Math.min(100, (entry.llmRequestDetails.contextManagement.tokenUsage.total / entry.llmRequestDetails.contextManagement.budget.total) * 100)}%`
                      }}
                    />
                  </div>
                </div>
                {/* Status badges */}
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-xs px-1.5 py-0.5 bg-violet-200 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 rounded">
                    {entry.llmRequestDetails.contextManagement.memoriesIncluded} memories
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-violet-200 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 rounded">
                    {entry.llmRequestDetails.contextManagement.messagesIncluded} messages
                  </span>
                  {entry.llmRequestDetails.contextManagement.includedSummary && (
                    <span className="text-xs px-1.5 py-0.5 bg-green-200 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded">
                      Has Summary
                    </span>
                  )}
                  {entry.llmRequestDetails.contextManagement.messagesTruncated && (
                    <span className="text-xs px-1.5 py-0.5 bg-amber-200 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded">
                      Truncated
                    </span>
                  )}
                </div>

                {/* Expandable: View Memories */}
                {entry.llmRequestDetails.contextManagement.debugMemories && entry.llmRequestDetails.contextManagement.debugMemories.length > 0 && (
                  <details className="mb-2 [&[open]>summary>svg.chevron]:rotate-90">
                    <summary className="text-xs cursor-pointer select-none text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 flex items-center gap-1">
                      <svg className="chevron w-3 h-3 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      View Memories ({entry.llmRequestDetails.contextManagement.debugMemories.length})
                    </summary>
                    <div className="mt-1 p-2 bg-violet-100 dark:bg-violet-900/30 rounded border border-violet-300 dark:border-violet-700 max-h-[200px] overflow-y-auto">
                      {entry.llmRequestDetails.contextManagement.debugMemories.map((mem, idx) => (
                        <div key={idx} className="text-xs mb-2 last:mb-0 pb-2 last:pb-0 border-b last:border-b-0 border-violet-200 dark:border-violet-700">
                          <div className="text-gray-800 dark:text-gray-200">{mem.summary}</div>
                          <div className="flex gap-2 mt-1 text-violet-600 dark:text-violet-400">
                            <span>Score: {(mem.score * 100).toFixed(0)}%</span>
                            <span>Importance: {(mem.importance * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Expandable: View Summary */}
                {entry.llmRequestDetails.contextManagement.debugSummary && (
                  <details className="mb-2 [&[open]>summary>svg.chevron]:rotate-90">
                    <summary className="text-xs cursor-pointer select-none text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 flex items-center gap-1">
                      <svg className="chevron w-3 h-3 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      View Conversation Summary
                    </summary>
                    <div className="mt-1 p-2 bg-green-100 dark:bg-green-900/30 rounded border border-green-300 dark:border-green-700 max-h-[200px] overflow-y-auto">
                      <div className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                        {entry.llmRequestDetails.contextManagement.debugSummary}
                      </div>
                    </div>
                  </details>
                )}

                {/* Expandable: View System Prompt */}
                {entry.llmRequestDetails.contextManagement.debugSystemPrompt && (
                  <details className="[&[open]>summary>svg.chevron]:rotate-90">
                    <summary className="text-xs cursor-pointer select-none text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-300 flex items-center gap-1">
                      <svg className="chevron w-3 h-3 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      View System Prompt ({entry.llmRequestDetails.contextManagement.tokenUsage.systemPrompt.toLocaleString()} tokens)
                    </summary>
                    <div className="mt-1 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded border border-yellow-300 dark:border-yellow-700 max-h-[300px] overflow-y-auto">
                      <div className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono">
                        {entry.llmRequestDetails.contextManagement.debugSystemPrompt}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Tools */}
            {entry.llmRequestDetails.tools && entry.llmRequestDetails.tools.length > 0 && (
              <div className="group/tools">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tools:</div>
                  <div className="opacity-0 group-hover/tools:opacity-100 transition-opacity">
                    <CopyButton content={JSON.stringify(entry.llmRequestDetails.tools, null, 2)} />
                  </div>
                </div>
                <div className="font-mono text-xs bg-white dark:bg-slate-800 rounded p-2 border border-cyan-200 dark:border-cyan-700 max-h-[200px] overflow-y-auto group-hover/tools:opacity-100">
                  <SyntaxHighlightedJSON content={JSON.stringify(entry.llmRequestDetails.tools, null, 2)} />
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {/* Memory Extraction Debug Logs - shown regardless of LLM Request Details */}
      {entry.debugMemoryLogs && entry.debugMemoryLogs.length > 0 && (
        <div className="mb-2 p-3 bg-indigo-100 dark:bg-indigo-900/60 rounded border-2 border-indigo-500 dark:border-indigo-600">
          <div className="text-xs font-semibold text-indigo-800 dark:text-indigo-200 mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000-2H6a6 6 0 016 6v3h2a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6a2 2 0 012-2h2V7a1 1 0 000 2H4z" clipRule="evenodd" />
            </svg>
            🧠 Memory Extraction ({entry.debugMemoryLogs.length})
          </div>
          <div className="space-y-2">
            {entry.debugMemoryLogs.map((log) => (
              <div key={`log-${log.substring(0, 50)}`} className="text-xs p-2 bg-indigo-50 dark:bg-slate-800 rounded border border-indigo-400 dark:border-indigo-500 font-mono whitespace-pre-wrap break-words text-indigo-900 dark:text-indigo-100">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final Event JSON (shown by default for completed streaming responses) */}
      {entry.finalEvent && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 group/final">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Final Response
            </span>
            <span className="ml-auto" />
            {entry.finalMetadata?.usage && (
              <span className="text-xs text-amber-600 dark:text-amber-500">
                {entry.finalMetadata.usage.totalTokens} tokens
              </span>
            )}
            <div className="opacity-0 group-hover/final:opacity-100 transition-opacity">
              <CopyButton content={JSON.stringify(entry.finalEvent, null, 2)} />
            </div>
          </div>
          <div className="font-mono text-xs bg-white dark:bg-slate-800 rounded p-2 border border-amber-200 dark:border-amber-700 max-h-[200px] overflow-y-auto group-hover/final:opacity-100">
            <SyntaxHighlightedJSON content={JSON.stringify(entry.finalEvent, null, 2)} />
          </div>
        </div>
      )}

      {/* Stitched Content (collapsible, for completed streaming responses) */}
      {hasStitchedContent && (
        <details className="border-b border-emerald-200 dark:border-emerald-800 group/stitched [&[open]>summary>svg.chevron]:rotate-90">
          <summary className="px-3 py-2 text-xs cursor-pointer select-none bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 flex items-center gap-1 group">
            <svg className="chevron w-3 h-3 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">Stitched Response Content</span>
            <span className="ml-auto text-emerald-600 dark:text-emerald-500">
              {entry.stitchedContent?.length || 0} chars
            </span>
            <div className="opacity-0 group-hover:opacity-100 group-hover/stitched:opacity-100 transition-opacity">
              <CopyButton content={entry.stitchedContent || ''} />
            </div>
          </summary>
          <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 group-hover/stitched:flex group-hover/stitched:flex-col">
            <div className="font-mono text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto bg-white dark:bg-slate-800 rounded p-2 border border-emerald-200 dark:border-emerald-700 group-hover/stitched:opacity-100">
              {entry.stitchedContent}
            </div>
            {/* Metadata badges */}
            {entry.finalMetadata && (
              <div className="flex flex-wrap gap-2 mt-2">
                {entry.finalMetadata.messageId && (
                  <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded">
                    ID: {entry.finalMetadata.messageId.slice(0, 8)}...
                  </span>
                )}
                {entry.finalMetadata.toolsDetected && (
                  <span className="text-xs px-2 py-0.5 bg-purple-200 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded">
                    {entry.finalMetadata.toolsDetected} tool(s) detected
                  </span>
                )}
                {entry.finalMetadata.toolsExecuted && (
                  <span className="text-xs px-2 py-0.5 bg-orange-200 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 rounded">
                    Tools executed
                  </span>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {/* Raw Data (collapsible) */}
      <details className="group/raw [&[open]>summary>svg.chevron]:rotate-90">
        <summary className="px-3 py-2 text-xs cursor-pointer select-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center gap-1 group">
          <svg className="chevron w-3 h-3 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {isOutgoing ? 'Show request payload' : hasStitchedContent ? 'Show raw SSE data' : 'Show response data'}
          <div className="opacity-0 group-hover:opacity-100 group-hover/raw:opacity-100 transition-opacity ml-auto">
            {!entry.error && (
              <CopyButton content={formattedData} />
            )}
          </div>
        </summary>
        <div className="p-3 max-h-[400px] overflow-y-auto font-mono text-gray-800 dark:text-gray-200 group-hover/raw:opacity-100">
          {entry.error ? (
            <div className="text-red-600 dark:text-red-400">
              <strong>Error:</strong> {entry.error}
            </div>
          ) : (
            <SyntaxHighlightedJSON content={formattedData} />
          )}
        </div>
      </details>
    </div>
  );
}

export default function DebugPanel() {
  const { entries, clearEntries } = useDebug();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-gray-600 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            API Debug
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({entries.length} entries)
          </span>
        </div>
        <button
          onClick={clearEntries}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
          title="Clear all entries"
        >
          Clear
        </button>
      </div>

      {/* Entries list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3"
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <svg
              className="w-12 h-12 mb-3 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm">No API traffic yet</p>
            <p className="text-xs mt-1">Send a message to see requests and responses</p>
          </div>
        ) : (
          entries.map((entry) => (
            <DebugEntryCard key={entry.id} entry={entry} />
          ))
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Outgoing
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Incoming
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" /> Pending
          </span>
        </div>
      </div>
    </div>
  );
}
