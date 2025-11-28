'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import type { Components } from 'react-markdown'

interface MessageContentProps {
  content: string
  className?: string
}

export default function MessageContent({ content, className = '' }: MessageContentProps) {
  const components: Components = {
    // Code blocks with syntax highlighting
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''
      const inline = !match
      const childrenString = typeof children === 'string' || typeof children === 'number' ? String(children) : ''

      return !inline && language ? (
        <div style={{
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          borderRadius: '0.375rem',
          marginTop: '0.5rem',
          marginBottom: '0.5rem',
        }}>
          <SyntaxHighlighter
            // @ts-expect-error - style type mismatch between library versions
            style={oneDark}
            language={language}
            PreTag="div"
            wrapLines={true}
            wrapLongLines={true}
            customStyle={{
              margin: 0,
              padding: '1rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
            {...props}
          >
            {childrenString.replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      ) : (
        <code className={`${className} bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm`} {...props}>
          {children}
        </code>
      )
    },
    // Paragraph spacing
    p({ children }) {
      return <p className="font-georgia mb-2 last:mb-0">{children}</p>
    },
    // Headings
    h1({ children }) {
      return <h1 className="font-georgia text-2xl font-bold mb-2 mt-4 first:mt-0">{children}</h1>
    },
    h2({ children }) {
      return <h2 className="font-georgia text-xl font-bold mb-2 mt-3 first:mt-0">{children}</h2>
    },
    h3({ children }) {
      return <h3 className="font-georgia text-lg font-semibold mb-2 mt-3 first:mt-0">{children}</h3>
    },
    h4({ children }) {
      return <h4 className="font-georgia text-base font-semibold mb-1 mt-2 first:mt-0">{children}</h4>
    },
    h5({ children }) {
      return <h5 className="font-georgia text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h5>
    },
    h6({ children }) {
      return <h6 className="font-georgia text-xs font-semibold mb-1 mt-2 first:mt-0">{children}</h6>
    },
    // Lists
    ul({ children }) {
      return <ul className="font-georgia list-disc list-inside mb-2 ml-4">{children}</ul>
    },
    ol({ children }) {
      return <ol className="font-georgia list-decimal list-inside mb-2 ml-4">{children}</ol>
    },
    li({ children }) {
      return <li className="font-georgia mb-1">{children}</li>
    },
    // Blockquotes
    blockquote({ children }) {
      return (
        <blockquote className="font-georgia border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 my-2 italic">
          {children}
        </blockquote>
      )
    },
    // Links
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {children}
        </a>
      )
    },
    // Tables
    table({ children }) {
      return (
        <div className="overflow-x-auto my-2">
          <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
            {children}
          </table>
        </div>
      )
    },
    thead({ children }) {
      return <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>
    },
    th({ children }) {
      return (
        <th className="font-georgia border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-semibold">
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td className="font-georgia border border-gray-300 dark:border-gray-600 px-4 py-2">
          {children}
        </td>
      )
    },
    // Horizontal rule
    hr() {
      return <hr className="my-4 border-gray-300 dark:border-gray-600" />
    },
    // Strong/bold
    strong({ children }) {
      return <strong className="font-bold">{children}</strong>
    },
    // Emphasis/italic
    em({ children }) {
      return <em className="italic">{children}</em>
    },
  }

  return (
    <>
      <style>{`
        .message-content pre {
          white-space: pre-wrap !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
          width: 100% !important;
          max-width: 100% !important;
          overflow: hidden !important;
        }
        .message-content code {
          white-space: pre-wrap !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
        }
      `}</style>
      <div className={`prose prose-sm dark:prose-invert max-w-none w-full message-content ${className}`} style={{ overflow: 'hidden' }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  )
}
