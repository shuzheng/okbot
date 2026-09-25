import { memo, useMemo, useState, type ReactNode } from 'react';
import { resolveUiLang, t } from '../../i18n';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/github-dark.min.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', shell);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('zsh', shell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('svg', xml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext);

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
      <rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6 14V6a2 2 0 0 1 2-2h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const lang = resolveUiLang(
    typeof document !== 'undefined' && document.documentElement.lang?.toLowerCase().startsWith('en')
      ? 'en'
      : 'zh',
  );
  return (
    <button
      type="button"
      className={`md-copy-btn${copied ? ' copied' : ''}`}
      onMouseDown={(e) => {
        // Keep focus path stable in Electron before clipboard write.
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
          const ok = await writeClipboard(text);
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        })();
      }}
      title={copied ? t(lang, 'copied') : t(lang, 'copy')}
      aria-label={copied ? t(lang, 'copied') : t(lang, 'copy')}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span>{copied ? t(lang, 'copied') : t(lang, 'copy')}</span>
    </button>
  );
}

const CodeBlock = memo(function CodeBlock({ language, code }: { language: string; code: string }) {
  const highlighted = useMemo(() => {
    const lang = language.toLowerCase();
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return '';
    }
  }, [code, language]);

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{language || 'text'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="hljs">
        {highlighted ? (
          <code
            className={language ? `language-${language}` : undefined}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code className={language ? `language-${language}` : undefined}>{code}</code>
        )}
      </pre>
    </div>
  );
});

function isInlineCode(
  className: string | undefined,
  node: { position?: { start?: { line?: number }; end?: { line?: number } } } | undefined,
): boolean {
  if ((className || '').includes('language-')) return false;
  const start = node?.position?.start?.line;
  const end = node?.position?.end?.line;
  if (start != null && end != null && end > start) return false;
  return true;
}

export const MarkdownContent = memo(function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {linkChildren}
            </a>
          ),
          code: ({ className, children: codeChildren, node }) => {
            const text = String(codeChildren).replace(/\n$/, '');
            if (
              isInlineCode(
                className,
                node as { position?: { start?: { line?: number }; end?: { line?: number } } },
              )
            ) {
              return <code className={className}>{codeChildren}</code>;
            }
            const match = /language-([^\s]+)/.exec(className || '');
            return <CodeBlock language={match?.[1] || 'text'} code={text} />;
          },
          pre: ({ children: preChildren }) => <>{preChildren as ReactNode}</>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
