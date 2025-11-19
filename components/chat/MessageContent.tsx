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

      return !inline && language ? (
        <SyntaxHighlighter
          // @ts-expect-error - style type mismatch between library versions
          style={oneDark}
          language={language}
          PreTag="div"
          className="rounded-md my-2"
          wrapLines={true}
          wrapLongLines={true}
          customStyle={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            overflow: 'hidden',
          }}
          codeTagProps={{
            style: {
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }
          }}
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={`${className} bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm`} {...props}>
          {children}
        </code>
      )
    },
    // Paragraph spacing
    p({ children }) {
      return <p className="mb-2 last:mb-0">{children}</p>
    },
    // Headings
    h1({ children }) {
      return <h1 className="text-2xl font-bold mb-2 mt-4 first:mt-0">{children}</h1>
    },
    h2({ children }) {
      return <h2 className="text-xl font-bold mb-2 mt-3 first:mt-0">{children}</h2>
    },
    h3({ children }) {
      return <h3 className="text-lg font-semibold mb-2 mt-3 first:mt-0">{children}</h3>
    },
    h4({ children }) {
      return <h4 className="text-base font-semibold mb-1 mt-2 first:mt-0">{children}</h4>
    },
    h5({ children }) {
      return <h5 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h5>
    },
    h6({ children }) {
      return <h6 className="text-xs font-semibold mb-1 mt-2 first:mt-0">{children}</h6>
    },
    // Lists
    ul({ children }) {
      return <ul className="list-disc list-inside mb-2 ml-4">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside mb-2 ml-4">{children}</ol>
    },
    li({ children }) {
      return <li className="mb-1">{children}</li>
    },
    // Blockquotes
    blockquote({ children }) {
      return (
        <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 my-2 italic">
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
        <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-semibold">
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">
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
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
