import { useEffect, useRef } from 'react';
import { EditorContent, useEditor as useTiptap, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown, markdownToDoc, markdownEquals } from './markdown';
import { cn } from '@/lib/cn';

interface ChapterEditorProps {
  /** Changes whenever a different file is opened. */
  documentKey: string;
  /** Markdown body to load. */
  body: string;
  /** Called with the new Markdown after every edit. */
  onChange(markdown: string): void;
  readOnly?: boolean;
  className?: string;
}

// The markdown extension needs the schema; it is created per editor instance so
// the registered markdown names match the active extension set.
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Placeholder.configure({ placeholder: '写下第一句话…' }),
];

export function ChapterEditor({
  documentKey,
  body,
  onChange,
  readOnly = false,
  className,
}: ChapterEditorProps) {
  // The markdown body most recently received from the editor itself, so store
  // round-trips do not reset the cursor.
  const lastEmitted = useRef<string | null>(null);
  const loadedDocumentKey = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useTiptap({
    extensions: [...EXTENSIONS, Markdown.configure({})],
    content: '',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'sc-editor-content',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor: instance }) => {
      const markdown = docToMarkdown(instance.getJSON() as JSONContent);
      lastEmitted.current = markdown;
      onChangeRef.current(markdown);
    },
  });

  // Load a document into the editor when the open file (or external body) changes.
  useEffect(() => {
    if (!editor) return;
    if (
      loadedDocumentKey.current === documentKey &&
      lastEmitted.current !== null &&
      markdownEquals(lastEmitted.current, body)
    )
      return;
    const doc = markdownToDoc(body);
    editor.commands.setContent(doc, { emitUpdate: false });
    lastEmitted.current = body;
    loadedDocumentKey.current = documentKey;
    // Put the cursor at the start of the body for a natural writing flow.
    editor.commands.setTextSelection(1);
  }, [editor, documentKey, body]);

  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  return (
    <div className={cn('sc-editor h-full overflow-y-auto', className)}>
      <div className="mx-auto max-w-[42rem] px-8 py-10 sm:px-12">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Imperative handle for toolbar actions. */
export type ChapterEditorInstance = Editor;
