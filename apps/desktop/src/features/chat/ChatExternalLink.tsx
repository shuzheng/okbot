import { memo, type ReactNode } from 'react';
import { WebsiteIcon } from '../../components/ui/icons';

/**
 * Chat hyperlink with Settings→官网 (WebsiteIcon) prefix.
 * Underline applies to the label only — the icon stays undecorated.
 */
export const ChatExternalLink = memo(function ChatExternalLink({
  href,
  children,
}: {
  href: string;
  children?: ReactNode;
}) {
  return (
    <a
      className="chat-ext-link"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="chat-ext-link-ico" aria-hidden>
        <WebsiteIcon />
      </span>
      <span className="chat-ext-link-label">{children}</span>
    </a>
  );
});
