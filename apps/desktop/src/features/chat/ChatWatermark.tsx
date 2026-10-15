/** Large static empty-state watermark (no metal-flow animation). */
export function ChatWatermark() {
  return (
    <div className="chat-watermark" aria-hidden>
      <span className="chat-watermark-metal">OkBot</span>
    </div>
  );
}
