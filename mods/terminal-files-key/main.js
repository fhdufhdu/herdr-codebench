import { View, div } from 'gpui-kit';
import { props, shared, closeOverlay, run } from 'herdr';

// Terminal bindings override layout bindings. Route this shared key to its owner.
export default class TerminalFilesKey extends View {
  init() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    run(shared('layout') === 'ade' ? 'ade.terminal-files' : 'codenav.terminal-files');
  }
  render() { return div(); }
}
