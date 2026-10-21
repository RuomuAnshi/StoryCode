import { useCallback, useEffect, useState } from 'react';
import { TitleBar, ResizeHandle } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { ExplorerPane } from './features/explorer/ExplorerPane';
import { EditorPane } from './features/editor/EditorPane';
import { AgentPane } from './features/agent/AgentPane';
import { ProjectDialog } from './features/explorer/ProjectDialog';
import { NewChapterDialog } from './features/explorer/NewChapterDialog';
import { ModelSettingsDialog } from './features/settings/ModelSettingsDialog';
import { SearchPalette } from './features/search/SearchPalette';
import { useTheme } from './lib/use-theme';
import { useResizable } from './lib/use-resizable';
import { useWorkspace } from './stores/workspace-store';
import { useEditor } from './stores/editor-store';
import { useAgent } from './stores/agent-store';
import { useSettings } from './stores/settings-store';

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const project = useWorkspace((state) => state.project);
  const isDesktop = useWorkspace((state) => state.isDesktop);
  const wordCount = useEditor((state) => state.wordCount);
  const document = useEditor((state) => state.document);
  const saveStatus = useEditor((state) => state.saveStatus);
  const lastSavedAt = useEditor((state) => state.lastSavedAt);
  const agentStatus = useAgent((state) => state.status);
  const agentPhase = useAgent((state) => state.phase);
  const settings = useSettings((state) => state.settings);
  const configured = useSettings((state) => state.isConfigured());
  const refreshKeyStatus = useSettings((state) => state.refreshKeyStatus);

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);

  const explorer = useResizable({
    min: 180,
    max: 380,
    initial: 244,
    edge: 'left',
    storageKey: 'storycode.explorer-width',
  });
  const agent = useResizable({
    min: 300,
    max: 620,
    initial: 400,
    edge: 'right',
    storageKey: 'storycode.agent-width',
  });

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  // Global shortcuts. ⌘K palette, ⌘, settings, ⌘B/⌘J toggle the rails, ⌘S save.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setExplorerOpen((current) => !current);
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setAgentOpen((current) => !current);
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void useEditor.getState().save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openCreateProject = useCallback(() => setProjectDialogOpen(true), []);

  // First launch: land on the project chooser instead of an empty editor.
  useEffect(() => {
    if (isDesktop && !project && !useWorkspace.getState().loading) {
      setProjectDialogOpen(true);
    }
    // Only on mount; subsequent closes must not re-trigger it.
  }, []);

  const onCreateChapter = useCallback(() => {
    if (!project) {
      setProjectDialogOpen(true);
      return;
    }
    setChapterDialogOpen(true);
  }, [project]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--sc-bg)] text-[var(--sc-text)]">
      <TitleBar
        projectName={project?.name ?? null}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={openSettings}
        onToggleExplorer={() => setExplorerOpen((current) => !current)}
        onToggleAgent={() => setAgentOpen((current) => !current)}
        onOpenSearch={() => setSearchOpen(true)}
        explorerOpen={explorerOpen}
        agentOpen={agentOpen}
      />

      <div className="flex min-h-0 flex-1">
        {explorerOpen && (
          <>
            <div style={{ width: explorer.width }} className="shrink-0 overflow-hidden">
              <ExplorerPane onCreateChapter={onCreateChapter} onOpenProject={openCreateProject} />
            </div>
            <ResizeHandle onPointerDown={explorer.onPointerDown} dragging={explorer.dragging} />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <EditorPane onCreateChapter={onCreateChapter} onOpenSettings={openSettings} />
        </main>

        {agentOpen && (
          <>
            <ResizeHandle onPointerDown={agent.onPointerDown} dragging={agent.dragging} />
            <div style={{ width: agent.width }} className="shrink-0 overflow-hidden">
              <AgentPane onOpenSettings={openSettings} />
            </div>
          </>
        )}
      </div>

      <StatusBar
        wordCount={wordCount}
        chapterTitle={document?.kind === 'chapter' ? document.meta.title : null}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        agentBusy={agentStatus === 'running'}
        agentPhase={agentPhase}
        modelLabel={settings.model}
        modelConfigured={configured}
      />

      <ProjectDialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} />
      <NewChapterDialog open={chapterDialogOpen} onClose={() => setChapterDialogOpen(false)} />
      <ModelSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
