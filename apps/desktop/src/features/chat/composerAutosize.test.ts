import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPOSER_SIDE_CHROME_FALLBACK,
  compactProbeWidth,
  decideComposerMultiline,
  resolveCompactProbeWidth,
  shouldAnimateComposerHeight,
} from './composerAutosize';

describe('compactProbeWidth', () => {
  it('subtracts side chrome from inner width once', () => {
    assert.equal(compactProbeWidth(400, 154), 246);
    assert.equal(compactProbeWidth(100, 154), 64);
  });
});

describe('resolveCompactProbeWidth', () => {
  it('uses inner width minus chrome when inner is available', () => {
    assert.equal(
      resolveCompactProbeWidth({
        innerClientWidth: 400,
        wrapClientWidth: 246,
        editableClientWidth: 240,
        sideChrome: 154,
      }),
      246,
    );
  });

  it('does not subtract chrome again from wrap width (post @-mention wrap)', () => {
    // Regression: parent was .composer-input-wrap (already slot width).
    assert.equal(
      resolveCompactProbeWidth({
        innerClientWidth: null,
        wrapClientWidth: 246,
        editableClientWidth: 240,
        sideChrome: COMPOSER_SIDE_CHROME_FALLBACK,
      }),
      246,
    );
    assert.notEqual(
      resolveCompactProbeWidth({
        innerClientWidth: null,
        wrapClientWidth: 246,
        editableClientWidth: 240,
        sideChrome: COMPOSER_SIDE_CHROME_FALLBACK,
      }),
      compactProbeWidth(246, COMPOSER_SIDE_CHROME_FALLBACK),
    );
  });

  it('falls back to editable width', () => {
    assert.equal(
      resolveCompactProbeWidth({
        innerClientWidth: 0,
        wrapClientWidth: 0,
        editableClientWidth: 80,
        sideChrome: 154,
      }),
      80,
    );
  });
});

describe('decideComposerMultiline', () => {
  const single = 28; // 18 line + 10 pad

  it('stays single until clearly past one line (+ enter band)', () => {
    assert.equal(
      decideComposerMultiline({
        compactScrollHeight: single + 2,
        singleLinePx: single,
        currentlyMultiline: false,
      }),
      false,
    );
    assert.equal(
      decideComposerMultiline({
        compactScrollHeight: single + 0.5 + 4 + 0.1,
        singleLinePx: single,
        currentlyMultiline: false,
      }),
      true,
    );
  });

  it('leaves multiline only when back to ~one line', () => {
    assert.equal(
      decideComposerMultiline({
        compactScrollHeight: single + 2,
        singleLinePx: single,
        currentlyMultiline: true,
      }),
      true,
    );
    assert.equal(
      decideComposerMultiline({
        compactScrollHeight: single,
        singleLinePx: single,
        currentlyMultiline: true,
      }),
      false,
    );
  });
});

describe('shouldAnimateComposerHeight', () => {
  it('skips transition when mode flips but height is unchanged', () => {
    assert.equal(
      shouldAnimateComposerHeight({ modeChanged: true, startH: 28, nextH: 28 }),
      false,
    );
  });

  it('animates when mode flips and height changes', () => {
    assert.equal(
      shouldAnimateComposerHeight({ modeChanged: true, startH: 28, nextH: 46 }),
      true,
    );
  });

  it('does not animate same-mode grows', () => {
    assert.equal(
      shouldAnimateComposerHeight({ modeChanged: false, startH: 46, nextH: 64 }),
      false,
    );
  });
});
