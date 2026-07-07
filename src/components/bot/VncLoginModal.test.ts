import { describe, it, expect } from 'vitest';
import { VNC_HIDDEN_CONTROL_IDS, buildVncDeclutterCss } from './VncLoginModal';

describe('VNC control-bar declutter', () => {
  it('hides the pointless/duplicate buttons but keeps the keyboard toggle', () => {
    expect(VNC_HIDDEN_CONTROL_IDS).toContain('noVNC_settings_button');
    expect(VNC_HIDDEN_CONTROL_IDS).toContain('noVNC_fullscreen_button');
    expect(VNC_HIDDEN_CONTROL_IDS).toContain('noVNC_disconnect_button');
    // The keyboard toggle is the only way to type on touch devices — must stay visible.
    expect(VNC_HIDDEN_CONTROL_IDS).not.toContain('noVNC_keyboard_button');
  });

  it('builds double-ID selectors that outrank noVNC\'s own show rule without !important', () => {
    const css = buildVncDeclutterCss();
    for (const id of VNC_HIDDEN_CONTROL_IDS) {
      expect(css).toContain(`#noVNC_control_bar #${id}`);
    }
    expect(css).not.toContain('noVNC_keyboard_button');
    expect(css).not.toContain('!important');
    expect(css.endsWith('{display:none}')).toBe(true);
  });

  it('is a comma-joined projection of every hidden id', () => {
    const expected = `${VNC_HIDDEN_CONTROL_IDS.map(id => `#noVNC_control_bar #${id}`).join(',')}{display:none}`;
    expect(buildVncDeclutterCss()).toBe(expected);
  });
});
