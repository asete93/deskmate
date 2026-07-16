// CodeMirror 6 — 에디터 인스턴스 팩토리 + 확장자별 언어 로드.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

function langFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return javascript({ jsx: /x$/.test(ext), typescript: /^ts/.test(ext) });
  if (ext === 'json') return json();
  if (['html', 'htm'].includes(ext)) return html();
  if (['css', 'scss'].includes(ext)) return css();
  if (['md', 'markdown'].includes(ext)) return markdown();
  if (['py'].includes(ext)) return python();
  return [];
}

export function createEditor({ parent, doc, path, onChange, onSave }) {
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(), highlightActiveLine(), drawSelection(), history(), indentOnInput(), bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { onSave?.(); return true; } },
        indentWithTab, ...defaultKeymap, ...historyKeymap,
      ]),
      langFor(path),
      oneDark,
      EditorView.updateListener.of(u => { if (u.docChanged) onChange?.(u.state.doc.toString()); }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '13px' } }),
    ],
  });
  return new EditorView({ state, parent });
}
