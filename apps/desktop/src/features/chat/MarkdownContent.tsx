import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChatImageFx } from './ChatImageFx';
import { resolveUiLang, t, type UiLang } from '../../i18n';
import {
  isOkbotAssetSrc,
  isSafeDataImageSrc,
  parseOwnerResourceSrc,
  resolveMediaAssetUrl,
} from '../../utils/mediaAsset';
import { BotMentionChip } from '../../components/ui/BotMentionChip';
import {
  botIdFromMentionHref,
  isBotMentionHref,
  linkifyBotMentions,
  type MentionBotRef,
} from '../../utils/botMentions';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
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


/** Thumbnail in bubble; plain img + lightbox click. */
function ChatThumbImage({ src, alt }: { src: string; alt?: string }) {
  return <ChatImageFx src={src} alt={alt} />;
}

/** Load ~/.okbot/<owner>/resources images via gateway /v1/media (CSP: no file:// / https). */
const OkbotAssetImage = memo(function OkbotAssetImage({
  src,
  alt,
  lang,
}: {
  src: string;
  alt?: string;
  lang: UiLang;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImgSrc(null);
    setError(null);
    const parsed = parseOwnerResourceSrc(src);
    if (!parsed) {
      setError('invalid asset path');
      return;
    }
    void (async () => {
      try {
        const mediaUrl = await resolveMediaAssetUrl(parsed.assetRel);
        if (cancelled) return;
        if (mediaUrl) {
          setImgSrc(mediaUrl);
          return;
        }
        // Fallback: Electron IPC data URL when gateway base/token is unavailable.
        const res = await window.okbot.readGeneratedAssetDataUrl(parsed.assetRel);
        if (cancelled) return;
        if (res && typeof res === 'object' && 'ok' in res && res.ok && 'dataUrl' in res) {
          setImgSrc(res.dataUrl as string);
        } else {
          const err =
            res && typeof res === 'object' && 'error' in res && typeof res.error === 'string'
              ? res.error
              : 'load failed';
          setError(err);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return (
      <span className="md-asset-missing" title={error}>
        {(alt ? `${alt} · ` : '') + t(lang, 'imageLoadFailed')}
      </span>
    );
  }
  return <ChatImageFx src={imgSrc} alt={alt} loading={!imgSrc} />;
});

/**
 * react-markdown's defaultUrlTransform only allows http(s)/mailto/irc/xmpp.
 * Keep `/v1/media/…`, legacy okbot-asset: / file://…/.okbot/…/resources/… for
 * gateway rewrite, and legacy data:image/* so old replies are not stripped to "".
 * New generate_image replies use `/v1/media/…` only. Never load arbitrary file://.
 */
function markdownUrlTransform(url: string): string {
  if (isBotMentionHref(url)) return url;
  if (parseOwnerResourceSrc(url)) return url;
  if (isSafeDataImageSrc(url)) return url;
  return defaultUrlTransform(url);
}

export const MarkdownContent = memo(function MarkdownContent({
  children,
  lang,
  bots = [],
  preferBotId,
}: {
  children: string;
  lang?: UiLang;
  /** Roster for resolving `@助手名` / `@id` mention chips. */
  bots?: readonly MentionBotRef[];
  /** Open-session owner id — duplicate names resolve to this bot's profile. */
  preferBotId?: string;
}) {
  const uiLang = lang ?? resolveUiLang(undefined);
  const source = useMemo(
    () => linkifyBotMentions(children, bots, preferBotId ? { preferBotId } : undefined),
    [children, bots, preferBotId],
  );
  const botsById = useMemo(() => {
    const map = new Map<string, MentionBotRef>();
    for (const b of bots) map.set(b.id, b);
    return map;
  }, [bots]);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{
          a: ({ href, children: linkChildren }) => {
            if (isBotMentionHref(href)) {
              const id = botIdFromMentionHref(href || '');
              const bot = botsById.get(id);
              if (bot) return <BotMentionChip bot={bot} />;
              // Roster may have changed; still show avatar+name chip from link text.
              const name = String(linkChildren ?? '').replace(/^@/, '').trim() || id;
              return (
                <BotMentionChip
                  bot={{ id, name, emoji: '🤖', color: '' }}
                />
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const resource = parseOwnerResourceSrc(src);
            if (resource || isOkbotAssetSrc(src)) {
              return <OkbotAssetImage src={src || ''} alt={alt} lang={uiLang} />;
            }
            if (src && isSafeDataImageSrc(src)) {
              return <ChatThumbImage src={src} alt={alt} />;
            }
            if (src && /^https?:/i.test(src)) {
              return (
                <span className="md-asset-missing" title={src}>
                  {t(uiLang, 'externalImageBlocked')}
                </span>
              );
            }
            // Never render bare file:// (CSP + security). Show missing instead.
            if (src && /^file:/i.test(src)) {
              return (
                <span className="md-asset-missing" title={src}>
                  {(alt ? `${alt} · ` : '') + t(uiLang, 'imageLoadFailed')}
                </span>
              );
            }
            if (src) return <ChatThumbImage src={src} alt={alt} />;
            return null;
          },
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
        {source}
      </ReactMarkdown>
    </div>
  );
});
