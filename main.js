const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    showUngrouped: true,
    collapsibleHeaders: true,
    compactMode: false,
    startCollapsed: false,
    groups: [],
    collapsedSections: [],
    collapsedGroups: {},
    collapsedSettingGroups: {},
    pluginNotes: {},
    noteTimestamps: {},
    notesFilePath: '',
    sidebarTooltipPosition: 'left',
    autoAppendDesc: false,
    knownPluginTabs: {},
    showSearchBar: true
};

module.exports = class SettingsSidebarOrganizerPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new OrganizerSettingTab(this.app, this));

        this.isOrganizing = false;
        this.observing = false;
        // Created lazily per settings-window open (see attachObserver) so it always lives in the
        // realm of whichever document — main or popout — the sidebar currently renders into.
        this.observer = null;

        this.app.workspace.onLayoutReady(async () => {
            await this.loadNotesFromFile();
            // Obsidian 1.13 opens settings in a separate window with its own document, so the
            // plugin hooks the settings modal's own lifecycle instead of watching the main window.
            this.initSettingHook();
        });

        this.registerEvent(this.app.vault.on('modify', async (file) => {
            if (this.settings.notesFilePath && file.path === this.settings.notesFilePath) {
                if (this.isWritingNotes) return;
                await this.loadNotesFromFile();
            }
        }));
    }

    hideCustomTooltip() {
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }
    }

    addCustomTooltip(element, contentBuilder, options = {}) {
        const extraClass = options.extraClass || '';
        const offset = options.offset || 8;

        element.addEventListener('mouseenter', () => {
            const position = (typeof options.position === 'function') ? options.position() : (options.position || 'top');
            this.hideCustomTooltip();

            // Anchors the tooltip to the element's own window so it renders correctly when
            // settings is a separate popout window (Obsidian 1.13).
            const doc = element.ownerDocument || document;
            const win = doc.defaultView || window;

            const tooltipEl = doc.createElement('div');
            tooltipEl.className = `my-org-custom-tooltip ${extraClass}`.trim();

            if (typeof contentBuilder === 'string') {
                tooltipEl.innerText = contentBuilder;
            } else if (typeof contentBuilder === 'function') {
                const content = contentBuilder();
                if (!content && !options.alwaysShow) return;
                if (typeof content === 'string') tooltipEl.innerText = content;
                // nodeType check instead of instanceof: the settings popout is a separate realm,
                // so its elements are not instances of this realm's HTMLElement.
                else if (content && content.nodeType === 1) tooltipEl.appendChild(content);
            }

            doc.body.appendChild(tooltipEl);
            this.activeTooltip = tooltipEl;

            const rect = element.getBoundingClientRect();
            const tipRect = tooltipEl.getBoundingClientRect();

            let left, top;
            if (position === 'top') {
                left = rect.left + (rect.width / 2) - (tipRect.width / 2);
                top = rect.top - tipRect.height - offset;
            } else if (position === 'bottom') {
                left = rect.left + (rect.width / 2) - (tipRect.width / 2);
                top = rect.bottom + offset;
            } else if (position === 'right') {
                left = rect.right + offset;
                top = rect.top + (rect.height / 2) - (tipRect.height / 2);
            } else if (position === 'left') {
                left = rect.left - tipRect.width - offset;
                top = rect.top + (rect.height / 2) - (tipRect.height / 2);
            }

            if (left + tipRect.width > win.innerWidth) left = rect.left - tipRect.width - offset;
            if (top + tipRect.height > win.innerHeight) top = win.innerHeight - tipRect.height - offset;
            if (left < 0) left = offset;
            if (top < 0) top = offset;

            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
        });

        element.addEventListener('mouseleave', () => this.hideCustomTooltip());
        if (options.hideOnClick !== false) {
            element.addEventListener('click', () => this.hideCustomTooltip());
        }
    }

    // --- Settings-window awareness (Obsidian 1.13 popout settings) ---

    // The document currently hosting the settings modal. In 1.13 this is the popout window's
    // document by default; the main document when "Open settings in window" is off, on mobile,
    // or when settings is closed. Derived from live element references on app.setting, which
    // move with the modal into whichever window it renders into.
    settingDoc() {
        const setting = this.app.setting;
        if (setting) {
            const el = setting.tabHeadersEl || setting.modalEl || setting.containerEl || setting.contentEl;
            if (el && el.ownerDocument) return el.ownerDocument;
        }
        return document;
    }

    isSettingOpen() {
        const setting = this.app.setting;
        const el = setting && (setting.modalEl || setting.containerEl);
        return !!(el && el.isConnected);
    }

    // The settings sidebar container (the vertical tab header). Persists across open/close and
    // lives in whichever document the settings modal currently renders into.
    getSidebarEl() {
        const setting = this.app.setting;
        if (setting && setting.tabHeadersEl) return setting.tabHeadersEl;
        return this.settingDoc().querySelector('.vertical-tab-header');
    }

    // Installs the settings-lifecycle hook, retrying briefly in case app.setting is not yet
    // populated at layout-ready. Without this, a slow/edge startup would leave the plugin inert
    // for the whole session (there is no fallback watcher anymore).
    initSettingHook(attempt = 0) {
        if (this.app.setting) {
            this.patchSettingLifecycle();
            if (this.isSettingOpen()) this.onSettingsOpened();
            return;
        }
        if (attempt < 20) {
            this._initTimer = window.setTimeout(() => this.initSettingHook(attempt + 1), 100);
        }
    }

    // Wraps the settings modal's own open/close lifecycle. There is no public "settings opened"
    // event in Obsidian, and the modal now lives in a separate window, so watching the main
    // document is no longer viable. The wrappers are guarded by _settingPatched so they become
    // pass-throughs after unload even if they can't be cleanly removed (see unpatch).
    patchSettingLifecycle() {
        const setting = this.app.setting;
        if (!setting || this._settingPatched) return;
        this._settingPatched = true;
        this._origSettingOnOpen = setting.onOpen;
        this._origSettingOnClose = setting.onClose;
        const self = this;
        this._onOpenWrapper = function (...args) {
            const result = self._origSettingOnOpen.apply(this, args);
            if (self._settingPatched) self.onSettingsOpened();
            return result;
        };
        this._onCloseWrapper = function (...args) {
            if (self._settingPatched) self.onSettingsClosed();
            return self._origSettingOnClose.apply(this, args);
        };
        setting.onOpen = this._onOpenWrapper;
        setting.onClose = this._onCloseWrapper;
    }

    unpatchSettingLifecycle() {
        const setting = this.app.setting;
        if (!setting || !this._settingPatched) return;
        // Marks the wrappers inert first so any still-installed wrapper (if another plugin wrapped
        // on top of ours) skips our logic and just passes through.
        this._settingPatched = false;
        // Only restore the original when our wrapper is still the outermost one; otherwise leave it
        // in place (now a pass-through) rather than clobbering the other plugin's wrapper.
        if (setting.onOpen === this._onOpenWrapper && this._origSettingOnOpen) {
            setting.onOpen = this._origSettingOnOpen;
            this._origSettingOnOpen = null;
            this._onOpenWrapper = null;
        }
        if (setting.onClose === this._onCloseWrapper && this._origSettingOnClose) {
            setting.onClose = this._origSettingOnClose;
            this._origSettingOnClose = null;
            this._onCloseWrapper = null;
        }
    }

    // Creates a fresh MutationObserver in the sidebar's own window realm and attaches it. Rebuilt
    // on every open so a missed close (e.g. the OS window's X) can't leave it bound to a destroyed
    // popout, and so it observes nodes in the correct realm.
    attachObserver(sidebar) {
        if (this.observer) this.observer.disconnect();
        const win = (sidebar.ownerDocument && sidebar.ownerDocument.defaultView) || window;
        const MO = win.MutationObserver || MutationObserver;
        this.observer = new MO((mutations) => {
            if (this.isOrganizing) return;
            if (mutations.some(m => m.type === 'childList')) this.checkAndApply();
        });
        this.observer.observe(sidebar, { childList: true, subtree: true });
        this.observing = true;
    }

    onSettingsOpened() {
        const doc = this.settingDoc();
        // Scopes collapsible-header styling to the settings window body
        doc.body.classList.toggle('my-org-collapse-enabled', this.settings.collapsibleHeaders);

        // Always (re)attaches, recovering even if a previous close was missed
        const sidebar = this.getSidebarEl();
        if (sidebar) this.attachObserver(sidebar);

        this.bindSettingWindowEvents(doc);
        this.checkAndApply(); // Applies before the settings window paints
    }

    onSettingsClosed() {
        if (this.observer) this.observer.disconnect();
        this.observing = false;
        this.unbindSettingWindowEvents();
        this.hideCustomTooltip();

        // Collapses groups when the settings modal closes
        if (this.settings.startCollapsed) {
            this.settings.collapsedGroups = {};
            this.saveSettings(false);

            // Strips the cached 'open' state from the detached HTML to prevent visual flashes
            // when the user reopens the settings modal because Obsidian caches it in memory.
            this.settingDoc().querySelectorAll('.my-org-folder').forEach(folder => {
                folder.removeAttribute('open');
            });
        }
    }

    // Binds the click/scroll handlers to the settings window. The settings popout is a distinct
    // window with its own document, so listeners on the main window never fire for it.
    bindSettingWindowEvents(doc) {
        if (this._settingEventsDoc === doc) return; // already bound to this window
        this.unbindSettingWindowEvents();
        const win = doc.defaultView || window;
        this._settingEventsDoc = doc;
        this._settingEventsWin = win;

        this._onSettingClick = (evt) => {
            if (this.activeTooltip && this.activeTooltip.classList.contains('my-org-sidebar-note-tooltip')) {
                this.activeTooltip.remove();
                this.activeTooltip = null;
            }

            // Removes active states on the proxies when the user clicks a native sidebar item or custom gear icon
            // (nodeType instead of instanceof: the settings popout is a separate realm in 1.13)
            if (evt.isTrusted && evt.target && evt.target.nodeType === 1) {
                const clickedTab = evt.target.closest('.vertical-tab-nav-item');
                const clickedGear = evt.target.closest('.my-org-section-btn');
                if ((clickedTab && !clickedTab.classList.contains('my-org-proxy')) || clickedGear) {
                    doc.querySelectorAll('.my-org-proxy.is-active').forEach(p => p.classList.remove('is-active'));
                }
            }

            // Catches the click and waits for Obsidian to finish rebuilding the sidebar
            if (evt.target && evt.target.nodeType === 1 && (evt.target.closest('.checkbox-container') || evt.target.closest('button'))) {
                if (evt.target.closest('.my-org-wide-modal')) return; // Ignores clicks inside the custom modal to prevent sidebar flickering
                if (this.clickTimer) clearTimeout(this.clickTimer);
                this.clickTimer = setTimeout(() => this.checkAndApply(), 150);
            }

            if (!this.settings.collapsibleHeaders) return;
            if (evt.target.closest('.my-org-section-btn')) return;

            if (evt.target.classList.contains('vertical-tab-header-group-title')) {
                const header = evt.target;
                const group = header.parentElement;
                const itemsContainer = group.querySelector('.vertical-tab-header-group-items');

                if (itemsContainer) {
                    // Uses the built-in data-section for language independence
                    const sectionId = itemsContainer.getAttribute('data-section') || header.innerText.trim();

                    const isCollapsed = itemsContainer.classList.toggle('is-collapsed');
                    header.classList.toggle('is-collapsed', isCollapsed);

                    if (isCollapsed) {
                        if (!this.settings.collapsedSections.includes(sectionId)) this.settings.collapsedSections.push(sectionId);
                    } else {
                        this.settings.collapsedSections = this.settings.collapsedSections.filter(t => t !== sectionId);
                    }
                    this.saveSettings(false);
                    evt.stopPropagation();
                }
            }
        };

        this._onSettingScroll = () => {
            if (this.activeTooltip) {
                this.activeTooltip.remove();
                this.activeTooltip = null;
            }
        };

        doc.addEventListener('click', this._onSettingClick);
        win.addEventListener('scroll', this._onSettingScroll, { capture: true });
    }

    unbindSettingWindowEvents() {
        if (this._settingEventsDoc && this._onSettingClick) {
            this._settingEventsDoc.removeEventListener('click', this._onSettingClick);
        }
        if (this._settingEventsWin && this._onSettingScroll) {
            this._settingEventsWin.removeEventListener('scroll', this._onSettingScroll, { capture: true });
        }
        this._onSettingClick = null;
        this._onSettingScroll = null;
        this._settingEventsDoc = null;
        this._settingEventsWin = null;
    }

    getCleanNote(id) {
        const raw = this.settings.pluginNotes[id];
        if (!raw) return '';
        return raw.replace(/<!--[\s\S]*?-->/g, '').trim();
    }

    async loadNotesFromFile() {
        if (!this.settings.notesFilePath || !this.settings.notesFilePath.endsWith('.md')) return;
        try {
            const filePath = this.settings.notesFilePath;
            if (!(await this.app.vault.adapter.exists(filePath))) return;

            const stat = await this.app.vault.adapter.stat(filePath);
            const content = await this.app.vault.adapter.read(filePath);
            const lines = content.split('\n');
            let currentPluginId = null;
            let currentNote = [];
            const fileNotes = {};

            const nameToId = {};
            if (this.app.plugins && this.app.plugins.manifests) {
                for (const id in this.app.plugins.manifests) {
                    nameToId[this.app.plugins.manifests[id].name.toLowerCase()] = id;
                }
            }

            for (const line of lines) {
                if (line.startsWith('# ')) {
                    if (currentPluginId && currentNote.length > 0) {
                        fileNotes[currentPluginId] = currentNote.join('\n').trim();
                    }
                    const pluginName = line.substring(2).trim().toLowerCase();
                    currentPluginId = nameToId[pluginName];
                    currentNote = [];
                } else if (currentPluginId) {
                    currentNote.push(line);
                }
            }
            if (currentPluginId && currentNote.length > 0) {
                fileNotes[currentPluginId] = currentNote.join('\n').trim();
            }

            let modifiedMemory = false;
            let needsFileWrite = false;
            if (!this.settings.noteTimestamps) this.settings.noteTimestamps = {};

            for (const id in fileNotes) {
                const fileContent = fileNotes[id];
                const memContent = this.settings.pluginNotes[id];
                const memTime = this.settings.noteTimestamps[id] || 0;

                if (!memContent || stat.mtime > memTime) {
                    if (memContent !== fileContent) {
                        this.settings.pluginNotes[id] = fileContent;
                        this.settings.noteTimestamps[id] = stat.mtime;
                        modifiedMemory = true;
                    }
                } else if (memContent !== fileContent && memTime > stat.mtime) {
                    needsFileWrite = true;
                }
            }

            for (const id in this.settings.pluginNotes) {
                if (this.settings.pluginNotes[id] && !fileNotes[id]) {
                    needsFileWrite = true;
                }
            }

            if (modifiedMemory) {
                await this.saveData(this.settings);
            }
            if (needsFileWrite) {
                await this.saveNotesToFile();
            }
        } catch (e) {
            console.error("Settings Sidebar Organizer: Failed to load notes from file", e);
        }
    }

    async saveNotesToFile() {
        if (!this.settings.notesFilePath || !this.settings.notesFilePath.endsWith('.md')) return;
        try {
            this.isWritingNotes = true;
            let content = '';

            if (this.app.plugins && this.app.plugins.manifests) {
                for (const id in this.settings.pluginNotes) {
                    const manifest = this.app.plugins.manifests[id];
                    if (manifest && this.settings.pluginNotes[id]) {
                        content += `# ${manifest.name}\n${this.settings.pluginNotes[id]}\n\n`;
                    }
                }
            }

            const filePath = this.settings.notesFilePath;
            const pathParts = filePath.split('/');
            let currentPath = '';
            for (let i = 0; i < pathParts.length - 1; i++) {
                currentPath += (currentPath ? '/' : '') + pathParts[i];
                if (!(await this.app.vault.adapter.exists(currentPath))) {
                    await this.app.vault.adapter.mkdir(currentPath);
                }
            }

            await this.app.vault.adapter.write(filePath, content.trim());
        } catch (e) {
            console.error("Settings Sidebar Organizer: Failed to save notes to file", e);
        } finally {
            setTimeout(() => { this.isWritingNotes = false; }, 500);
        }
    }

    // Removes the injected folders and un-hides the native nav items, scoped to the given
    // document. Shared by every path that rebuilds the sidebar so the reset stays in one place.
    clearOrganizedDom(doc) {
        doc.querySelectorAll('.my-org-folder').forEach(f => f.remove());
        doc.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));
    }

    onunload() {
        if (this.observer) this.observer.disconnect();
        this.observing = false;
        this.unbindSettingWindowEvents();
        this.unpatchSettingLifecycle();
        if (this.clickTimer) clearTimeout(this.clickTimer); // Clears pending timers
        if (this._initTimer) clearTimeout(this._initTimer);

        // All injected sidebar DOM lives inside the settings modal element, which persists across
        // open/close regardless of which document currently hosts it (a popout window may already
        // be destroyed by now, so querying the document would miss nothing that matters).
        const setting = this.app.setting;
        const root = (setting && (setting.modalEl || setting.containerEl)) || this.settingDoc();

        root.querySelectorAll('.my-org-folder').forEach(f => f.remove());
        root.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));

        // Targets only settings modal headers to prevent breaking Obsidian\'s native file explorer
        root.querySelectorAll('.vertical-tab-header-group-title.is-collapsed, .vertical-tab-header-group-items.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));

        root.querySelectorAll('.my-org-hide-nav').forEach(el => el.classList.remove('my-org-hide-nav'));
        root.querySelectorAll('.my-org-section-btn').forEach(btn => btn.remove());

        // The collapse styling class may have been applied to either window's body over the session
        this.settingDoc().body.classList.remove('my-org-collapse-enabled');
        if (document.body) document.body.classList.remove('my-org-collapse-enabled');

        // Cleans up any floating tooltip
        this.hideCustomTooltip();
        this.settingDoc().querySelectorAll('.my-org-custom-tooltip').forEach(t => t.remove());
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(shouldReorganize = true) {
        await this.saveData(this.settings);
        if (shouldReorganize) {
            this.clearOrganizedDom(this.settingDoc());
            this.checkAndApply();
        }
    }

    restoreSectionStates() {
        if (!this.settings.collapsibleHeaders) return;
        const sidebar = this.getSidebarEl();
        if (!sidebar) return;
        const headers = sidebar.querySelectorAll('.vertical-tab-header-group-title');
        headers.forEach(header => {
            const group = header.parentElement;
            const items = group.querySelector('.vertical-tab-header-group-items');
            if (items) {
                // Reads the safe section ID
                const sectionId = items.getAttribute('data-section') || header.innerText.trim();
                if (this.settings.collapsedSections.includes(sectionId)) {
                    header.classList.add('is-collapsed');
                    items.classList.add('is-collapsed');
                }
            }
        });
    }

    manageCompactMode() {
        const doc = this.settingDoc();
        if (this.settings.compactMode) {
            // Searches by immutable setting IDs (language independent)
            const coreNav = doc.querySelector('.vertical-tab-nav-item[data-setting-id="plugins"]');
            const commNav = doc.querySelector('.vertical-tab-nav-item[data-setting-id="community-plugins"]');
            const targetNavItems = [coreNav, commNav].filter(Boolean);

            const coreSection = doc.querySelector('.vertical-tab-header-group-items[data-section="core-plugins"]');
            const commSection = doc.querySelector('.vertical-tab-header-group-items[data-section="community-plugins"]');

            const targetHeaders = [];
            if (coreSection && coreSection.previousElementSibling) targetHeaders.push(coreSection.previousElementSibling);
            if (commSection && commSection.previousElementSibling) targetHeaders.push(commSection.previousElementSibling);

            targetNavItems.forEach(item => {
                item.classList.add('my-org-hide-nav');
            });

            targetHeaders.forEach(header => {
                if (header.querySelector('.my-org-section-btn')) return;

                const btn = doc.createElement('div');
                btn.className = 'my-org-section-btn';
                btn.setAttribute('aria-label', 'Manage plugins');
                obsidian.setIcon(btn, 'settings');

                btn.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    // Manually clears proxy active states because stopPropagation blocks the global listener
                    doc.querySelectorAll('.my-org-proxy.is-active').forEach(p => p.classList.remove('is-active'));

                    // Connects the gear icon with the hidden menu button
                    if (header === (coreSection && coreSection.previousElementSibling) && coreNav) {
                        coreNav.click();
                    } else if (header === (commSection && commSection.previousElementSibling) && commNav) {
                        commNav.click();
                    }
                };
                header.appendChild(btn);
            });
        } else {
            doc.querySelectorAll('.my-org-hide-nav').forEach(item => item.classList.remove('my-org-hide-nav'));
            doc.querySelectorAll('.my-org-section-btn').forEach(b => b.remove());
        }
    }

    checkAndApply() {
        const sidebar = this.settingDoc().querySelector('.vertical-tab-header-group-items');
        if (!sidebar) return;

        // Restores collapse if needed
        if (this.settings.collapsibleHeaders) {
            this.restoreSectionStates();
        }

        this.organizeSidebar();
        this.manageCompactMode();
    }

    organizeSidebar() {
        // Sets flag to indicate internal DOM modification so the Observer ignores changes
        this.isOrganizing = true;

        // Resolves the settings window's document up front so every element is created and queried
        // in the window the settings modal currently renders into (a popout window in 1.13).
        const doc = this.settingDoc();

        if (!this.app.plugins || !this.app.plugins.manifests) {
            this.isOrganizing = false;
            return;
        }

        // Detects newly installed plugins to automatically restore their synced notes
        if (!this.knownInstalledPlugins) {
            this.knownInstalledPlugins = new Set(Object.keys(this.app.plugins.manifests));
        } else {
            let newlyInstalled = false;
            const newlyFoundIds = [];
            for (const id in this.app.plugins.manifests) {
                if (!this.knownInstalledPlugins.has(id)) {
                    this.knownInstalledPlugins.add(id);
                    newlyFoundIds.push(id);
                    newlyInstalled = true;
                }
            }
            for (const id of this.knownInstalledPlugins) {
                if (!this.app.plugins.manifests[id]) {
                    this.knownInstalledPlugins.delete(id);
                }
            }
            if (newlyInstalled && this.settings.notesFilePath) {
                this.loadNotesFromFile(); // Triggers async two-way sync
            }
            // Auto-appends official descriptions for newly installed plugins when the feature is enabled
            if (newlyInstalled && this.settings.autoAppendDesc && newlyFoundIds.length > 0) {
                let added = false;
                for (const id of newlyFoundIds) {
                    const manifest = this.app.plugins.manifests[id];
                    if (!manifest || !manifest.description) continue;
                    const currentNote = this.settings.pluginNotes[id] || '';
                    if (!currentNote.includes(manifest.description)) {
                        this.settings.pluginNotes[id] = currentNote ? currentNote + '\n\n' + manifest.description : manifest.description;
                        if (!this.settings.noteTimestamps) this.settings.noteTimestamps = {};
                        this.settings.noteTimestamps[id] = Date.now();
                        added = true;
                    }
                }
                if (added) {
                    this.saveSettings(false).then(() => this.saveNotesToFile());
                }
            }
        }

        let targetContainer = doc.querySelector('.vertical-tab-header-group-items[data-section="community-plugins"]');

        if (!targetContainer) {
            const firstCommunityPlugin = doc.querySelector('.vertical-tab-nav-item[data-setting-id]');
            if (firstCommunityPlugin) {
                targetContainer = firstCommunityPlugin.parentElement;
            }
        }

        if (!targetContainer) {
            this.isOrganizing = false;
            return;
        }

        targetContainer.querySelectorAll('.my-org-folder').forEach(el => el.remove());
        targetContainer.querySelectorAll('.my-org-hidden').forEach(el => el.classList.remove('my-org-hidden'));
        targetContainer.querySelectorAll('.my-org-search-container').forEach(el => el.remove());

        const pluginItems = Array.from(targetContainer.querySelectorAll('.vertical-tab-nav-item'));

        const groupsMap = this.settings.groups.map((g, idx) => {
            const details = doc.createElement('details');
            details.className = 'my-org-folder';
            const savedState = this.settings.collapsedGroups[idx];
            const isOpen = savedState !== undefined ? savedState : !this.settings.startCollapsed;
            details.open = isOpen;

            // Creates element safely
            details.createEl('summary', { cls: 'my-org-summary', text: g.title });

            details.addEventListener('toggle', () => {
                if (this.currentSearchQuery) return;
                this.settings.collapsedGroups[idx] = details.open;
                this.saveSettings(false);
            });
            return {
                data: g,
                element: details,
                keywords: g.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
                items: g.items || [],
                proxies: []
            };
        });

        const ungroupedDetails = doc.createElement('details');
        ungroupedDetails.className = 'my-org-folder my-org-special';
        const savedUngroupedState = this.settings.collapsedGroups['Ungrouped'];
        ungroupedDetails.open = savedUngroupedState !== undefined ? savedUngroupedState : !this.settings.startCollapsed;
        ungroupedDetails.addEventListener('toggle', () => {
            if (this.currentSearchQuery) return;
            this.settings.collapsedGroups['Ungrouped'] = ungroupedDetails.open;
            this.saveSettings(false);
        });
        const ungroupedSummary = doc.createElement('summary');
        ungroupedSummary.className = 'my-org-summary';
        ungroupedSummary.innerText = 'Ungrouped';
        ungroupedDetails.appendChild(ungroupedSummary);

        let ungroupedCount = 0;
        let foldersInserted = false;

        let executeSearch = null;

        const insertFolders = (referenceNode) => {
            if (foldersInserted) return;
            if (this.settings.showSearchBar) {
                const searchContainer = doc.createElement('div');
                searchContainer.className = 'my-org-search-container';
                const searchInput = doc.createElement('input');
                searchInput.type = 'search';
                searchInput.placeholder = 'Search...';
                searchInput.className = 'my-org-search-input';
                searchInput.value = this.currentSearchQuery || '';

                const applySearch = () => {
                    const query = searchInput.value.toLowerCase().trim();
                    this.currentSearchQuery = query;
                    const detailsEls = targetContainer.querySelectorAll('details.my-org-folder');

                    detailsEls.forEach(details => {
                        let hasVisible = false;
                        const items = details.querySelectorAll('.my-org-proxy');
                        items.forEach(item => {
                            const text = item.textContent.toLowerCase();
                            if (text.includes(query)) {
                                item.style.display = '';
                                hasVisible = true;
                            } else {
                                item.style.display = 'none';
                            }
                        });

                        if (query !== '') {
                            details.style.display = hasVisible ? '' : 'none';
                            if (hasVisible) details.open = true;
                        } else {
                            details.style.display = '';
                            const isUngrouped = details.classList.contains('my-org-special');
                            let savedState = true;
                            if (isUngrouped) {
                                savedState = this.settings.collapsedGroups['Ungrouped'];
                            } else {
                                const summaryText = details.querySelector('summary')?.textContent;
                                const idx = this.settings.groups.findIndex(g => g.title === summaryText);
                                if (idx !== -1) savedState = this.settings.collapsedGroups[idx];
                            }
                            details.open = savedState !== undefined ? savedState : !this.settings.startCollapsed;
                        }
                    });
                };

                executeSearch = applySearch;
                searchInput.addEventListener('input', applySearch);
                searchContainer.appendChild(searchInput);
                targetContainer.insertBefore(searchContainer, referenceNode);
            }
            groupsMap.forEach(g => targetContainer.insertBefore(g.element, referenceNode));
            if (this.settings.showUngrouped) targetContainer.insertBefore(ungroupedDetails, referenceNode);
            foldersInserted = true;
        };

        pluginItems.forEach(item => {
            const uiName = item.innerText.trim();
            const settingId = item.getAttribute('data-setting-id');
            const manifest = settingId ? this.app.plugins.manifests[settingId] : null;

            // Ensures it\'s a valid community plugin
            if (!manifest) return;
            const manifestName = manifest.name;

            if (item.classList.contains('my-org-hidden')) return;

            insertFolders(item);

            let matchedCount = 0;
            for (const group of groupsMap) {
                // Claims the plugin for the group even if it's manually hidden via the eye icon
                if (this.isPluginMatchedByGroup(settingId, manifest, uiName, group.data, true)) {
                    matchedCount++; // Prevents it from falling into the Ungrouped section

                    // Checks if it should be rendered in the sidebar (not manually hidden)
                    if (this.isPluginMatchedByGroup(settingId, manifest, uiName, group.data, false)) {
                        // Looks up configuration using the official manifest name
                        const config = group.items.find(i => i.name === manifestName);

                        // Falls back to the user interface name if no alias is set
                        const globalAlias = this.getGlobalAlias(settingId);
                        const displayName = (config && config.alias) ? config.alias : (globalAlias || uiName);

                        // Passes the settingId instead of text for reliable clicking
                        const proxy = this.createProxy(displayName, settingId, item, targetContainer);
                        group.element.appendChild(proxy);

                        // Pushes manifestName so manual sorting arrays match perfectly
                        group.proxies.push({ name: manifestName, element: proxy });
                    }
                }
            }

            if (matchedCount > 0) {
                item.classList.add('my-org-hidden');
            } else {
                if (this.settings.showUngrouped) {
                    const globalAlias = this.getGlobalAlias(settingId);
                    const proxy = this.createProxy(globalAlias || uiName, settingId, item, targetContainer);
                    ungroupedDetails.appendChild(proxy);
                    ungroupedCount++;
                    item.classList.add('my-org-hidden');
                } else {
                    item.classList.add('my-org-hidden');
                }
            }
        });

        if (this.settings.showUngrouped && ungroupedCount === 0) {
            ungroupedDetails.style.display = 'none';
        }

        if (!foldersInserted) {
            insertFolders(null);
        }

        groupsMap.forEach(group => {
            if (group.proxies.length === 0) {
                group.element.remove();
                return;
            }
            const definedOrder = group.items.map(i => i.name);
            group.proxies.sort((a, b) => {
                const idxA = definedOrder.indexOf(a.name);
                const idxB = definedOrder.indexOf(b.name);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
            group.proxies.forEach(p => group.element.appendChild(p.element));
        });

        if (this.settings.showUngrouped) {
            if (ungroupedCount > 0) ungroupedSummary.innerText = `Ungrouped (${ungroupedCount})`;
            else ungroupedDetails.remove();
        }

        if (executeSearch && this.currentSearchQuery) {
            executeSearch();
        }

        // Resets flag instantly after operation completes and clears pending observer queue
        if (this.observer) this.observer.takeRecords();
        this.isOrganizing = false;
    }

    getGlobalAlias(settingId) {
        let globalAlias = '';
        if (this.settings.groups) {
            for (const group of this.settings.groups) {
                if (group.items) {
                    const found = group.items.find(i => i.id === settingId);
                    if (found && found.alias) {
                        globalAlias = found.alias;
                        break;
                    }
                }
            }
        }
        return globalAlias;
    }

    createProxy(displayName, settingId, originalItem, container) {
        const doc = (container && container.ownerDocument) || this.settingDoc();
        const proxy = doc.createElement('div');
        proxy.className = 'vertical-tab-nav-item my-org-proxy';
        proxy.innerText = displayName;
        proxy.setAttribute('data-setting-id', settingId);

        // Checks if originalItem is still in the Document Object Model and active for initial styling
        if (originalItem && originalItem.classList.contains('is-active')) {
            proxy.classList.add('is-active');
        }

        this.addCustomTooltip(proxy, () => {
            if (this.settings.sidebarTooltipPosition === 'hidden') return null;
            return this.getCleanNote(settingId);
        }, {
            position: () => this.settings.sidebarTooltipPosition || 'left',
            extraClass: 'my-org-sidebar-note-tooltip',
            offset: 10
        });

        proxy.onclick = (e) => {
            e.stopPropagation();

            // Provides immediate visual feedback for responsiveness
            container.querySelectorAll('.my-org-proxy').forEach(p => p.classList.remove('is-active'));
            container.querySelectorAll(`.my-org-proxy[data-setting-id="${settingId}"]`).forEach(p => p.classList.add('is-active'));

            // Finds the current live element using the exact setting ID attribute
            const freshTarget = container.querySelector(`.vertical-tab-nav-item[data-setting-id="${settingId}"]:not(.my-org-proxy)`);

            if (freshTarget) {
                freshTarget.click();
            } else {
                // Falls back to original reference if the fresh element isn\'t found
                if (originalItem) originalItem.click();
            }
        };
        return proxy;
    }

    getMatchData(id, manifest, uiName, groupConfig) {
        const { positive, negative } = this.parseKeywords(groupConfig.keywords);
        if (positive.length === 0) return { posMatch: false };

        const texts = [manifest.name.toLowerCase(), uiName.toLowerCase()];
        const posMatch = positive.some(k => texts.some(t => t.includes(k)));

        const isExcluded = negative.some(k => texts.some(t => t.includes(k)));
        const isHidden = groupConfig.items && groupConfig.items.some(item => (item.id === id || item.name === manifest.name) && item.isExcluded);

        return {
            posMatch,
            isExcluded,
            isHidden
        };
    }

    isPluginMatchedByGroup(id, manifest, uiName, groupConfig, ignoreExclusion = false) {
        if (groupConfig.isLocked) {
            if (!groupConfig.lockedPluginIds || !groupConfig.lockedPluginIds.includes(id)) {
                return false;
            }
            if (!ignoreExclusion) {
                const isHidden = groupConfig.items && groupConfig.items.some(item => (item.id === id || item.name === manifest.name) && item.isExcluded);
                if (isHidden) return false;
            }
            return true;
        }
        const data = this.getMatchData(id, manifest, uiName, groupConfig);
        if (!data.posMatch) return false;
        if (data.isExcluded) return false;
        if (!ignoreExclusion && data.isHidden) return false;
        return true;
    }

    parseKeywords(keywordString) {
        if (!keywordString) return { positive: [], negative: [] };
        const parts = keywordString.split(',').map(k => k.trim()).filter(Boolean);
        const positive = [];
        const negative = [];
        for (let p of parts) {
            let isNegative = false;
            if (p.startsWith('!')) {
                isNegative = true;
                p = p.substring(1).trim();
            }
            if (p.startsWith('"') && p.endsWith('"')) {
                p = p.substring(1, p.length - 1).trim();
            }
            if (p) {
                if (isNegative) negative.push(p.toLowerCase());
                else positive.push(p.toLowerCase());
            }
        }
        return { positive, negative };
    }
}

class GroupConfigModal extends obsidian.Modal {
    constructor(app, plugin, groupIndex, onSaveCallback) {
        super(app);
        this.plugin = plugin;
        this.groupIndex = groupIndex;
        this.group = this.plugin.settings.groups[groupIndex];
        this.onSaveCallback = onSaveCallback;
        this.listContainer = null;

        this.initialStates = {};
        this.pendingStates = {};
    }

    checkForChanges() {
        const isItemsChanged = JSON.stringify(this.originalItems) !== JSON.stringify(this.items);
        const isList2Changed = JSON.stringify(this.originalList2) !== JSON.stringify(this.list2);
        const isStateChanged = Object.keys(this.pendingStates).some(id => this.pendingStates[id] !== this.initialStates[id]);
        if (this.saveBtn) this.saveBtn.disabled = !(isItemsChanged || isList2Changed || isStateChanged);
    }

    updateSaveState() {
        if (this.saveBtn) {
            this.saveBtn.disabled = !this.hasChanges;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.allHidden = false;
        this.allEnabled = true;

        const titleSetting = new obsidian.Setting(contentEl)
            .setName(`Matched plugins in ${this.group.title}`)
            .setDesc('Reorder, toggle, hide, rename and write notes.')
            .setHeading();

        titleSetting.nameEl.style.display = 'flex';
        titleSetting.nameEl.style.alignItems = 'center';

        const masterToggleEl = titleSetting.nameEl.createDiv({ cls: 'my-org-plugin-toggle' });
        masterToggleEl.style.marginLeft = '10px';

        const masterToggle = new obsidian.ToggleComponent(masterToggleEl).setValue(this.allEnabled);
        this.masterToggle = masterToggle;
        this.plugin.addCustomTooltip(masterToggle.toggleEl, "Enable/Disable all plugins in this group", { position: 'top' });
        masterToggle.onChange(val => {
            if (this.isInitializing) return;
            this.allEnabled = val;
            this.items.forEach(i => this.pendingStates[i.id] = val);
            this.list2.forEach(i => this.pendingStates[i.id] = val);
            this.checkForChanges();
            this.renderList();
        });

        this.initialStates = {};
        this.pendingStates = {};

        this.modalEl.classList.add('my-org-wide-modal');

        const keywords = this.group.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        const allPluginsMap = this.app.plugins && this.app.plugins.manifests ? this.app.plugins.manifests : {};
        const matchedPlugins = [];
        let knownTabsChanged = false;

        Object.keys(allPluginsMap).forEach(id => {
            const manifest = allPluginsMap[id];
            const tab = this.app.setting.pluginTabs?.find(t => t.id === id);
            const uiName = tab ? tab.name : manifest.name;
            const isEnabled = this.app.plugins.enabledPlugins.has(id);

            let currentItems = this.group.items || [];
            const existingItem = currentItems.find(i => i.id === id || i.name === manifest.name);

            // Remembers if disabled plugins have a settings menu because Obsidian API hides tabs for disabled plugins
            let hasUI = false;
            if (isEnabled) {
                hasUI = !!tab;
                if (this.plugin.settings.knownPluginTabs[id] !== hasUI) {
                    this.plugin.settings.knownPluginTabs[id] = hasUI;
                    knownTabsChanged = true;
                }
            } else {
                hasUI = this.plugin.settings.knownPluginTabs[id] || (existingItem && existingItem.hasUI !== undefined ? existingItem.hasUI : false);
            }

            if (this.plugin.isPluginMatchedByGroup(id, manifest, uiName, this.group, true)) {
                matchedPlugins.push({ id, name: manifest.name, uiName, hasUI });
            }
        });

        if (knownTabsChanged) {
            this.plugin.saveSettings(false);
        }

        let currentItems = this.group.items || [];
        this.list1 = [];
        this.list2 = [];
        const newlyAddedList1 = [];

        matchedPlugins.forEach(p => {
            const existing = currentItems.find(i => i.name === p.name);
            const isEnabled = this.app.plugins.enabledPlugins.has(p.id);

            // Inherits existing alias from any group if it exists
            const globalAlias = this.plugin.getGlobalAlias(p.id);

            // Restores UI presence from memory or verifies it dynamically
            if (p.hasUI) {
                if (!existing) {
                    newlyAddedList1.push({ name: p.name, id: p.id, alias: globalAlias, hasUI: true, isExcluded: false });
                } else if (!existing.alias && globalAlias) {
                    existing.alias = globalAlias; // Syncs missing alias
                }
            } else {
                if (existing) {
                    existing.id = p.id;
                    existing.hasUI = false;
                    existing.isExcluded = !!existing.isExcluded;
                    if (!existing.alias && globalAlias) existing.alias = globalAlias;
                    this.list2.push(existing);
                } else {
                    this.list2.push({ name: p.name, id: p.id, alias: globalAlias, hasUI: false, isExcluded: false });
                }
            }

            this.initialStates[p.id] = isEnabled;
            this.pendingStates[p.id] = isEnabled;
        });

        // Reconstructs list1 in the saved custom order
        currentItems.forEach(existingItem => {
            const stillMatchesAndHasUI = matchedPlugins.find(p => p.name === existingItem.name && p.hasUI);
            if (stillMatchesAndHasUI) {
                existingItem.id = stillMatchesAndHasUI.id; // Updates ID
                existingItem.hasUI = true; // Ensures explicitly saved
                existingItem.isExcluded = !!existingItem.isExcluded;
                this.list1.push(existingItem);
            }
        });

        // Sorts newly added items alphabetically (case insensitive) and appends to list1
        newlyAddedList1.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.list1.push(...newlyAddedList1);

        this.list2.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.originalItems = JSON.parse(JSON.stringify(this.list1));
        this.items = JSON.parse(JSON.stringify(this.list1));
        this.originalList2 = JSON.parse(JSON.stringify(this.list2));
        this.list2 = JSON.parse(JSON.stringify(this.list2));

        const totalItems = [...this.list1, ...this.list2];
        if (totalItems.length > 0) {
            this.isInitializing = true;
            this.allEnabled = totalItems.every(i => this.initialStates[i.id]);
            if (this.masterToggle) {
                this.masterToggle.setValue(this.allEnabled);
            }
            if (this.list1.length > 0) {
                this.allHidden = this.list1.every(i => i.isExcluded);
            }
            this.isInitializing = false;
        }

        // Prevents Obsidian's auto-focus from highlighting the sort select menu or inputs
        setTimeout(() => {
            const active = this.contentEl.ownerDocument.activeElement;
            if (active && (active.tagName === 'SELECT' || active.tagName === 'INPUT')) {
                active.blur();
            }
        }, 10);

        this.listContainer = contentEl.createDiv({ cls: 'my-org-modal-list' });



        this.renderList();

        const btnDiv = contentEl.createDiv({ cls: 'my-org-modal-actions my-org-actions-centered' });
        this.saveBtn = btnDiv.createEl('button', { text: 'Save changes', cls: 'mod-cta' });
        this.saveBtn.disabled = true;
        this.saveBtn.onclick = async () => {
            const combinedItems = [...this.items, ...this.list2];
            this.plugin.settings.groups[this.groupIndex].items = combinedItems;

            // Syncs aliases across all other groups based on unique plugin ID
            const aliasMap = {};
            combinedItems.forEach(i => {
                if (i.alias !== undefined) aliasMap[i.id] = i.alias;
            });

            this.plugin.settings.groups.forEach((g, idx) => {
                if (idx === this.groupIndex) return;
                g.items.forEach(gItem => {
                    if (aliasMap[gItem.id] !== undefined) {
                        gItem.alias = aliasMap[gItem.id];
                    }
                });
            });

            // Saves data before blocking the thread
            await this.plugin.saveSettings(false);

            let stateChanged = false;
            const pluginManager = this.app.plugins;

            for (const [id, willEnable] of Object.entries(this.pendingStates)) {
                if (id === this.plugin.manifest.id) continue;

                const wasEnabled = this.initialStates[id];
                if (willEnable && !wasEnabled) {
                    pluginManager.enabledPlugins.add(id);
                    await pluginManager.enablePlugin(id);
                    stateChanged = true;
                } else if (!willEnable && wasEnabled) {
                    pluginManager.enabledPlugins.delete(id);
                    await pluginManager.disablePlugin(id);
                    stateChanged = true;
                }
            }

            if (stateChanged && pluginManager.requestSave) pluginManager.requestSave();

            this.close();

            // Refreshes the sidebar layout synchronously to prevent visual flashes
            this.plugin.clearOrganizedDom(this.plugin.settingDoc());
            this.plugin.checkAndApply();

            if (this.onSaveCallback) this.onSaveCallback();
        };
    }

    renderList() {
        this.listContainer.empty();
        if (this.items.length === 0 && this.list2.length === 0) {
            this.listContainer.createDiv({ text: 'No plugins found matching keywords.', cls: 'my-org-modal-empty' });
            return;
        }

        const createRow = (item, index, isList1, parentContainer) => {
            const row = parentContainer.createDiv({ cls: 'my-org-modal-item' });
            const ctrls = row.createDiv({ cls: 'my-org-modal-controls' });

            if (isList1) {
                row.classList.add('my-org-draggable-row');

                const dragHandle = ctrls.createDiv({ cls: 'my-org-modal-drag-handle' });
                obsidian.setIcon(dragHandle, 'menu');

                // Drag tracking must bind to the settings window (a popout in 1.13), not the main window
                const dragWin = (dragHandle.ownerDocument && dragHandle.ownerDocument.defaultView) || window;

                const onPointerMove = (pe) => {
                    parentContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                        el.classList.remove('drop-target-above', 'drop-target-below');
                    });

                    let closestRow = null;
                    let closestDist = Infinity;
                    const rows = Array.from(parentContainer.querySelectorAll('.my-org-draggable-row'));

                    rows.forEach(r => {
                        const rect = r.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        const dist = Math.abs(pe.clientY - midY);
                        if (dist < closestDist) {
                            closestDist = dist;
                            closestRow = r;
                        }
                    });

                    if (closestRow) {
                        const rect = closestRow.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        if (pe.clientY < midY) {
                            closestRow.classList.add('drop-target-above');
                        } else {
                            closestRow.classList.add('drop-target-below');
                        }
                    }

                    // Auto-scrolls when mouse is near container edges
                    const containerRect = parentContainer.getBoundingClientRect();
                    const threshold = 40;
                    if (pe.clientY - containerRect.top < threshold) {
                        parentContainer.scrollTop -= 8;
                    } else if (containerRect.bottom - pe.clientY < threshold) {
                        parentContainer.scrollTop += 8;
                    }
                };

                const onPointerUp = (pe) => {
                    row.classList.remove('is-dragging');
                    parentContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                        el.classList.remove('drop-target-above', 'drop-target-below');
                    });

                    let closestRow = null;
                    let closestDist = Infinity;
                    let closestIndex = -1;
                    const rows = Array.from(parentContainer.querySelectorAll('.my-org-draggable-row'));

                    rows.forEach((r, idx) => {
                        const rect = r.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        const dist = Math.abs(pe.clientY - midY);
                        if (dist < closestDist) {
                            closestDist = dist;
                            closestRow = r;
                            closestIndex = idx;
                        }
                    });

                    if (closestRow && closestIndex !== -1) {
                        const fromIndex = this.draggedIndex;
                        let toIndex = closestIndex;
                        const rect = closestRow.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;

                        if (pe.clientY >= midY) toIndex++;
                        if (fromIndex < toIndex) toIndex--;

                        if (fromIndex !== toIndex) {
                            const itemToMove = this.items.splice(fromIndex, 1)[0];
                            this.items.splice(toIndex, 0, itemToMove);
                            this.checkForChanges();
                            this.renderList();
                        }
                    }

                    this.draggedIndex = null;
                    dragWin.removeEventListener('pointermove', onPointerMove);
                    dragWin.removeEventListener('pointerup', onPointerUp);
                };

                dragHandle.addEventListener('pointerdown', (pe) => {
                    pe.preventDefault();
                    this.draggedIndex = index;
                    row.classList.add('is-dragging');

                    dragWin.addEventListener('pointermove', onPointerMove);
                    dragWin.addEventListener('pointerup', onPointerUp);
                });
            }

            const currentState = this.pendingStates[item.id];

            const toggleEl = ctrls.createDiv({ cls: 'my-org-plugin-toggle' });
            const toggleComp = new obsidian.ToggleComponent(toggleEl)
                .setValue(currentState);

            this.plugin.addCustomTooltip(toggleComp.toggleEl, () => this.pendingStates[item.id] ? "Disable this plugin (NOT matching)" : "Enable this plugin (NOT matching)", { position: 'top' });

            let eyeIconEl = null;
            let updateEyeIcon = () => { };

            if (isList1) {
                eyeIconEl = ctrls.createDiv({ cls: 'my-org-exclude-icon clickable-icon' });
                updateEyeIcon = () => {
                    const isCrossed = !this.pendingStates[item.id] || item.isExcluded;
                    obsidian.setIcon(eyeIconEl, isCrossed ? 'eye-off' : 'eye');
                    eyeIconEl.classList.toggle('is-hidden', !!isCrossed);
                };
                updateEyeIcon();

                this.plugin.addCustomTooltip(eyeIconEl, () => item.isExcluded ? "Show (in this group)" : "Hide (in this group)", { position: 'top' });

                eyeIconEl.onclick = () => {
                    if (!this.pendingStates[item.id]) return;
                    item.isExcluded = !item.isExcluded;
                    updateEyeIcon();
                    updateNameStyle();
                    this.checkForChanges();
                };
            }

            const nameNode = row.createDiv({ text: item.name });
            const updateNameStyle = () => {
                nameNode.className = 'my-org-modal-item-name';
                if (!this.pendingStates[item.id]) nameNode.classList.add('is-disabled');
                if (isList1 && item.isExcluded) nameNode.classList.add('is-hidden');
            };
            updateNameStyle();

            toggleComp.onChange(val => {
                this.pendingStates[item.id] = val;
                this.checkForChanges();
                updateNameStyle();
                updateEyeIcon();
            });

            if (isList1) {
                const input = row.createEl('input', { type: 'text', placeholder: 'Alias...' });
                input.value = item.alias || '';
                input.oninput = (e) => {
                    this.items[index].alias = e.target.value;
                    this.checkForChanges();
                };
            }

            const cleanNoteText = this.plugin.getCleanNote(item.id);
            const noteBtn = row.createDiv({ cls: `my-org-modal-btn my-org-note-btn ${cleanNoteText ? 'has-note' : ''}` });
            obsidian.setIcon(noteBtn, 'file-text');

            this.plugin.addCustomTooltip(noteBtn, () => {
                const text = this.plugin.getCleanNote(item.id);
                if (text) return text;
                const fallback = (noteBtn.ownerDocument || document).createElement('div');
                fallback.className = 'my-org-note-fallback';
                fallback.innerText = "Click to add note";
                return fallback;
            }, { position: 'top', extraClass: 'my-org-note-tooltip', alwaysShow: true });

            noteBtn.onclick = () => {
                new PluginNoteModal(this.app, item, this.plugin, () => {
                    this.renderList();
                }).open();
            };
        };

        if (this.items.length > 0) {
            const headerRow = this.listContainer.createDiv({ cls: 'my-org-toolbar-row' });

            const leftDiv = headerRow.createDiv({ cls: 'my-org-toolbar-left' });
            leftDiv.createDiv({ cls: 'my-org-tt-header-title', text: `Plugins with a settings menu (${this.items.length})` });

            const masterEye = leftDiv.createDiv({ cls: 'clickable-icon' });
            obsidian.setIcon(masterEye, this.allHidden ? 'eye-off' : 'eye');
            this.plugin.addCustomTooltip(masterEye, "Hide/Unhide plugins with a settings menu", { position: 'bottom' });
            masterEye.onclick = () => {
                this.allHidden = !this.allHidden;
                obsidian.setIcon(masterEye, this.allHidden ? 'eye-off' : 'eye');
                this.items.forEach(i => i.isExcluded = this.allHidden);
                this.checkForChanges();
                this.renderList();
            };

            const resetBtn = leftDiv.createDiv({ cls: 'clickable-icon' });
            obsidian.setIcon(resetBtn, 'rotate-ccw');

            this.plugin.addCustomTooltip(resetBtn, "Reset aliases and order", { position: 'bottom' });
            resetBtn.onclick = () => {
                this.items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
                this.items.forEach(i => i.alias = '');
                this.checkForChanges();
                this.renderList();
            };

            const rightDiv = headerRow.createDiv({ cls: 'my-org-toolbar-right' });
            const sortContainer = rightDiv.createDiv({ cls: 'my-org-sort-container' });
            const sortSelect = sortContainer.createEl('select', { cls: 'dropdown my-org-sort-select' });
            sortSelect.add(new Option('Sort by...', 'none'));
            sortSelect.add(new Option('Alias A-Z', 'az'));
            sortSelect.add(new Option('Alias Z-A', 'za'));
            sortSelect.onchange = () => {
                if (sortSelect.value === 'az') {
                    this.items.sort((a, b) => (a.alias || a.name).localeCompare(b.alias || b.name, undefined, { sensitivity: 'base' }));
                } else if (sortSelect.value === 'za') {
                    this.items.sort((a, b) => (b.alias || b.name).localeCompare(a.alias || a.name, undefined, { sensitivity: 'base' }));
                }
                sortSelect.value = 'none';
                this.checkForChanges();
                this.renderList();
            };

            rightDiv.createDiv({ cls: 'my-org-notes-header', text: 'Notes' });
        }

        this.items.forEach((item, index) => createRow(item, index, true, this.listContainer));

        if (this.list2.length > 0) {
            if (this.items.length > 0) {
                this.listContainer.createEl('hr', { cls: 'my-org-modal-divider' });
            }

            const list2HeaderRow = this.listContainer.createDiv({ cls: 'my-org-toolbar-row' });

            const leftDiv2 = list2HeaderRow.createDiv({ cls: 'my-org-toolbar-left' });
            leftDiv2.createDiv({ cls: 'my-org-tt-header-title', text: `Plugins without a settings menu (${this.list2.length})` });

            const rightDiv2 = list2HeaderRow.createDiv({ cls: 'my-org-toolbar-right' });
            rightDiv2.createDiv({ cls: 'my-org-notes-header', text: '' });

            const list2Container = this.listContainer.createDiv({ cls: 'my-org-list2-container' });
            this.list2.forEach((item, index) => createRow(item, index, false, list2Container));
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.dragWheelHandler) {
            window.removeEventListener('wheel', this.dragWheelHandler);
            this.dragWheelHandler = null;
        }
    }
}

class OrganizerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

    // The scrollable ancestor of the settings content, found by inspecting overflow so it works
    // regardless of whether the tab content or its container is the scroller.
    getScrollEl() {
        const win = (this.containerEl.ownerDocument && this.containerEl.ownerDocument.defaultView) || window;
        let el = this.containerEl;
        while (el && el !== this.containerEl.ownerDocument.body) {
            const overflowY = win.getComputedStyle(el).overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
            el = el.parentElement;
        }
        return this.containerEl;
    }

    // Rebuilds the settings tab while keeping the scroll position, so collapsing/expanding or
    // reordering a group doesn't jump the view back to the top.
    displayPreservingScroll() {
        const scrollEl = this.getScrollEl();
        const st = scrollEl.scrollTop;
        this.display();
        // Restore synchronously, before the browser paints, so the rebuilt content is never shown
        // scrolled to the top for a frame (which looked like a flash). display() builds the DOM
        // synchronously, so the full scroll height is already in place here.
        scrollEl.scrollTop = st;
        // Re-affirm on the next animation frame (still before paint) in case any layout settles
        // after the synchronous set — belt-and-suspenders that never repaints if already correct.
        const win = (scrollEl.ownerDocument && scrollEl.ownerDocument.defaultView) || window;
        win.requestAnimationFrame(() => { scrollEl.scrollTop = st; });
    }

    bindBadgeHoverLogic(badge) {
        badge.addEventListener('mouseenter', () => {
            if (this.plugin.activeTooltip) this.plugin.activeTooltip.remove();
            const tooltipData = badge.tooltipDataObject;
            if (!tooltipData) return;

            // Renders into the badge's own window so the tooltip shows in the settings popout (1.13)
            const doc = badge.ownerDocument || document;

            const tooltipEl = doc.createElement('div');
            tooltipEl.className = 'my-org-custom-tooltip';

            const line1 = tooltipEl.createDiv({ cls: 'my-org-modal-help-text my-org-tt-help-1' });
            line1.appendChild(doc.createTextNode("Use "));
            line1.createSpan({ text: "," });
            line1.appendChild(doc.createTextNode(" to separate. Prefix with "));
            line1.createSpan({ text: "!" });
            line1.appendChild(doc.createTextNode(" to exclude."));

            const line2 = tooltipEl.createDiv({ cls: 'my-org-modal-help-text' });
            line2.appendChild(doc.createTextNode("Example: "));
            line2.createSpan({ text: "table, !\"advanced table\", sidebar organizer" });

            if (tooltipData.length === 0) {
                tooltipEl.createDiv({ cls: 'my-org-tt-line', text: 'No plugins match these keywords.' });
            } else {
                const uiPlugins = [];
                const noUiPlugins = [];

                tooltipData.forEach(item => {
                    const isEnabled = this.plugin.app.plugins.enabledPlugins.has(item.id);
                    const processedItem = { ...item, isEnabled: isEnabled };

                    if (processedItem.hasUI) uiPlugins.push(processedItem);
                    else noUiPlugins.push(processedItem);
                });

                const renderPluginLine = (container, p, displayIndex) => {
                    const line = container.createDiv({ cls: 'my-org-tt-line' });
                    if (!p.isEnabled || (p.matchData && p.matchData.isExcluded) || (p.matchData && p.matchData.isHidden)) {
                        line.classList.add('is-disabled');
                    }

                    const counter = displayIndex + 1;
                    const space = counter < 10 ? '\u00A0' : '';
                    line.createSpan({ text: `${space}${counter}. ` });

                    line.createSpan({ cls: 'my-org-tt-name', text: p.manifestName });

                    if (p.uiName) {
                        line.createSpan({ cls: 'my-org-tt-muted', text: ' (sidebar: ' });
                        line.createSpan({ cls: 'my-org-tt-white', text: p.uiName });
                        line.createSpan({ cls: 'my-org-tt-muted', text: ')' });
                    }

                    if (!p.isEnabled) {
                        line.createSpan({ cls: 'my-org-tt-status', text: ' (disabled)' });
                    }

                    if (p.matchData && p.matchData.isHidden) {
                        line.createSpan({ cls: 'my-org-tt-status', text: ' (hidden)' });
                    }

                    if (p.otherGroups.length > 0) {
                        line.createSpan({ cls: 'my-org-tt-others', text: ` [also in: ${p.otherGroups.join(', ')}]` });
                    }
                };

                const uiBlock = tooltipEl.createDiv();
                if (uiPlugins.length > 0) {
                    uiBlock.createDiv({ cls: 'my-org-tt-header', text: 'Plugins with a settings menu' });
                    uiPlugins.forEach((p, idx) => renderPluginLine(uiBlock, p, idx));
                }

                if (noUiPlugins.length > 0) {
                    const noUiBlock = tooltipEl.createDiv();
                    if (uiPlugins.length > 0) {
                        noUiBlock.classList.add('my-org-tt-spacing');
                    }
                    noUiBlock.createDiv({ cls: 'my-org-tt-header', text: 'Plugins without a settings menu' });
                    noUiPlugins.forEach((p, idx) => renderPluginLine(noUiBlock, p, idx));
                }
            }

            doc.body.appendChild(tooltipEl);
            this.plugin.activeTooltip = tooltipEl;

            const badgeRect = badge.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            tooltipEl.style.left = `${badgeRect.left + (badgeRect.width / 2) - (tooltipRect.width / 2)}px`;
            tooltipEl.style.top = `${badgeRect.top - tooltipRect.height - 8}px`;
        });

        badge.addEventListener('mouseleave', () => {
            if (this.plugin.activeTooltip) {
                this.plugin.activeTooltip.remove();
                this.plugin.activeTooltip = null;
            }
        });
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();


        new obsidian.Setting(containerEl)
            .setName('Collapsible headers')
            .setDesc('Allow collapsing "Options", "Core plugins", and "Community plugins".')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.collapsibleHeaders)
                .onChange(async (value) => {
                    this.plugin.settings.collapsibleHeaders = value;
                    await this.plugin.saveSettings();
                    const doc = this.plugin.settingDoc();
                    if (!value) {
                        doc.querySelectorAll('.vertical-tab-header-group-title.is-collapsed, .vertical-tab-header-group-items.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));
                    }
                    doc.body.classList.toggle('my-org-collapse-enabled', value);
                }));

        new obsidian.Setting(containerEl)
            .setName('Compact mode')
            .setDesc('Moves "Core plugins" and "Community plugins" buttons from the Options list to their respective section headers.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.compactMode)
                .onChange(async (value) => {
                    this.plugin.settings.compactMode = value;
                    await this.plugin.saveSettings(false);
                    this.plugin.checkAndApply();
                }));

        new obsidian.Setting(containerEl)
            .setName('Collapse by default')
            .setDesc('Start with all folders collapsed when opening the settings menu.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.startCollapsed)
                .onChange(async (value) => {
                    this.plugin.settings.startCollapsed = value;
                    await this.plugin.saveSettings(true);
                }));

        new obsidian.Setting(containerEl)
            .setName('Show search bar')
            .setDesc('Display a search bar above community plugins to filter by alias or name.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSearchBar)
                .onChange(async (value) => {
                    this.plugin.settings.showSearchBar = value;
                    await this.plugin.saveSettings(true);
                }));

        new obsidian.Setting(containerEl)
            .setName('Show ungrouped plugins')
            .setDesc('Move plugins that do not match any group into a special "Ungrouped" folder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showUngrouped)
                .onChange(async (value) => {
                    this.plugin.settings.showUngrouped = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('hr');

        new obsidian.Setting(containerEl)
            .setName('Sidebar notes tooltip position')
            .setDesc('Choose where the note tooltip should appear when hovering over community plugins in the sidebar.')
            .addDropdown(dropdown => dropdown
                .addOption('left', 'Left')
                .addOption('right', 'Right')
                .addOption('hidden', 'Hidden')
                .setValue(this.plugin.settings.sidebarTooltipPosition || 'left')
                .onChange(async (value) => {
                    this.plugin.settings.sidebarTooltipPosition = value;
                    await this.plugin.saveSettings(true);
                }));

        new obsidian.Setting(containerEl)
            .setName('Auto-add notes')
            .setDesc('Automatically create notes with official descriptions for newly installed plugins (or add to existing notes if missing).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoAppendDesc || false)
                .onChange(async (value) => {
                    this.plugin.settings.autoAppendDesc = value;
                    await this.plugin.saveSettings(true);
                    if (value) {
                        new BulkAppendModal(this.app, this.plugin, () => { }).open();
                    }
                }));

        let notesBtnEl = null;

        new obsidian.Setting(containerEl)
            .setName('Notes file path')
            .setDesc('The .md file path where you can easily edit your plugin notes from one place via synchronization. If left empty or invalid, notes will only be saved internally.')
            .addText(text => {
                text.inputEl.classList.add('my-org-path-input');
                text.setPlaceholder('e.g. ".obsidian/plugins/Notes.md"')
                    .setValue(this.plugin.settings.notesFilePath)
                    .onChange(async (value) => {
                        this.plugin.settings.notesFilePath = value;
                        await this.plugin.saveSettings();
                        if (value && value.endsWith('.md')) {
                            if (await this.app.vault.adapter.exists(value)) {
                                if (notesBtnEl) notesBtnEl.classList.add('is-active');
                                await this.plugin.loadNotesFromFile();
                            } else {
                                await this.plugin.saveNotesToFile();
                                if (await this.app.vault.adapter.exists(value)) {
                                    if (notesBtnEl) notesBtnEl.classList.add('is-active');
                                    new obsidian.Notice('Created new sync file and exported existing notes.');
                                } else {
                                    if (notesBtnEl) notesBtnEl.classList.remove('is-active');
                                }
                            }
                        } else {
                            if (notesBtnEl) notesBtnEl.classList.remove('is-active');
                        }
                    });
            })
            .addExtraButton(b => {
                notesBtnEl = b.extraSettingsEl;
                notesBtnEl.classList.add('my-org-sync-icon');
                b.setIcon('file-text')
                    .setTooltip('Open notes file')
                    .onClick(async () => {
                        if (!this.plugin.settings.notesFilePath) {
                            new obsidian.Notice('Sync path is empty! File sync is disabled.');
                            return;
                        }
                        const filePath = this.plugin.settings.notesFilePath;
                        if (!(await this.app.vault.adapter.exists(filePath))) {
                            new obsidian.Notice('File not found. Try saving a note first to create it.');
                            return;
                        }

                        const file = this.app.vault.getAbstractFileByPath(filePath);
                        if (file instanceof obsidian.TFile) {
                            this.app.setting.close();
                            this.app.workspace.getLeaf(false).openFile(file);
                        } else {
                            try {
                                this.app.showInFolder(filePath);
                            } catch (e) {
                                new obsidian.Notice('Cannot open hidden files directly on this device.');
                            }
                        }
                    });

                (async () => {
                    const filePath = this.plugin.settings.notesFilePath;
                    if (filePath && filePath.endsWith('.md') && await this.app.vault.adapter.exists(filePath)) {
                        notesBtnEl.classList.add('is-active');
                    }
                })();
            });

        containerEl.createEl('hr');
        const groupedHeading = new obsidian.Setting(containerEl).setHeading();
        groupedHeading.nameEl.appendText('Grouped community plugins ');
        groupedHeading.nameEl.createSpan({ text: `(${this.plugin.settings.groups.length} groups)`, cls: 'my-org-counter' });

        let allCollapsed = this.plugin.settings.groups.length > 0 && this.plugin.settings.groups.every((g, i) => this.plugin.settings.collapsedSettingGroups[i]);

        groupedHeading.addExtraButton(b => {
            b.setIcon(allCollapsed ? 'chevrons-down' : 'chevrons-up')
                .setTooltip(allCollapsed ? 'Expand all groups' : 'Collapse all groups')
                .onClick(async () => {
                    const willCollapse = !allCollapsed;
                    this.plugin.settings.groups.forEach((g, i) => {
                        this.plugin.settings.collapsedSettingGroups[i] = willCollapse;
                    });
                    await this.plugin.saveSettings(false);
                    this.displayPreservingScroll();
                });
            b.extraSettingsEl.style.marginRight = '8px';
        });

        const sortContainer = groupedHeading.controlEl.createDiv({ cls: 'my-org-global-sort-container' });
        const sortSelect = sortContainer.createEl('select', { cls: 'dropdown my-org-sort-select' });
        sortSelect.add(new Option('Sort by...', 'none'));
        sortSelect.add(new Option('Title A-Z', 'az'));
        sortSelect.add(new Option('Title Z-A', 'za'));
        sortSelect.onchange = async () => {
            const val = sortSelect.value;
            if (val === 'none') return;
            sortSelect.value = 'none';

            const indexMap = Array.from({ length: this.plugin.settings.groups.length }, (_, i) => i);

            if (val === 'az') {
                indexMap.sort((a, b) => this.plugin.settings.groups[a].title.localeCompare(this.plugin.settings.groups[b].title, undefined, { sensitivity: 'base' }));
            } else if (val === 'za') {
                indexMap.sort((a, b) => this.plugin.settings.groups[b].title.localeCompare(this.plugin.settings.groups[a].title, undefined, { sensitivity: 'base' }));
            }

            const newGroups = [];
            const newCollapsedGroups = {};
            const newCollapsedSettingGroups = {};

            if (this.plugin.settings.collapsedGroups['Ungrouped'] !== undefined) {
                newCollapsedGroups['Ungrouped'] = this.plugin.settings.collapsedGroups['Ungrouped'];
            }

            indexMap.forEach((oldIndex, newIndex) => {
                newGroups.push(this.plugin.settings.groups[oldIndex]);
                if (this.plugin.settings.collapsedGroups[oldIndex] !== undefined) {
                    newCollapsedGroups[newIndex] = this.plugin.settings.collapsedGroups[oldIndex];
                }
                if (this.plugin.settings.collapsedSettingGroups[oldIndex] !== undefined) {
                    newCollapsedSettingGroups[newIndex] = this.plugin.settings.collapsedSettingGroups[oldIndex];
                }
            });

            this.plugin.settings.groups = newGroups;
            this.plugin.settings.collapsedGroups = newCollapsedGroups;
            this.plugin.settings.collapsedSettingGroups = newCollapsedSettingGroups;

            await this.plugin.saveSettings();
            sortSelect.blur();
            this.displayPreservingScroll();
        };

        const recalculateAllMatches = () => {
            const pluginMatches = {};
            const allPluginsMap = this.app.plugins && this.app.plugins.manifests ? this.app.plugins.manifests : {};
            const tabsMap = {};
            if (this.app.setting.pluginTabs) {
                this.app.setting.pluginTabs.forEach(t => tabsMap[t.id] = t);
            }

            let knownTabsChanged = false;

            Object.keys(allPluginsMap).forEach(id => {
                const manifest = allPluginsMap[id];
                const tab = tabsMap[id];
                const isEnabled = this.app.plugins.enabledPlugins.has(id);

                let hasUI = false;
                if (isEnabled) {
                    hasUI = !!tab;
                    if (this.plugin.settings.knownPluginTabs[id] !== hasUI) {
                        this.plugin.settings.knownPluginTabs[id] = hasUI;
                        knownTabsChanged = true;
                    }
                } else {
                    hasUI = this.plugin.settings.knownPluginTabs[id] || false;
                }

                pluginMatches[id] = {
                    id: id,
                    manifestName: manifest.name,
                    uiName: tab ? tab.name : manifest.name,
                    groups: [],
                    groupIndices: [],
                    groupsMap: {},
                    hasUI: hasUI
                };
            });

            if (knownTabsChanged) {
                this.plugin.saveSettings(false);
            }

            this.plugin.settings.groups.forEach((g, idx) => {
                Object.keys(pluginMatches).forEach(id => {
                    const p = pluginMatches[id];
                    const manifest = allPluginsMap[id];
                    const matchData = this.plugin.getMatchData(id, manifest, p.uiName, g);

                    if (g.isLocked) {
                        if (!g.lockedPluginIds || !g.lockedPluginIds.includes(id)) {
                            matchData.posMatch = false;
                        }
                    }

                    p.groupsMap[idx] = matchData;

                    if (matchData.posMatch && !matchData.isExcluded) {
                        p.groups.push(g.title);
                        p.groupIndices.push(idx);
                    }
                });
            });
            return pluginMatches;
        };

        const badgeUpdaters = [];

        const listContainer = containerEl.createDiv({ cls: 'my-org-group-list' });



        this.plugin.settings.groups.forEach((group, index) => {
            const isCollapsed = this.plugin.settings.collapsedSettingGroups[index] || false;
            const div = listContainer.createDiv({ cls: 'my-org-group-card my-org-group-draggable-row' });

            const headerSetting = new obsidian.Setting(div).setHeading();

            headerSetting.nameEl.style.display = 'flex';
            headerSetting.nameEl.style.alignItems = 'center';
            headerSetting.nameEl.style.gap = '8px';

            const dragHandle = headerSetting.nameEl.createSpan({ cls: 'clickable-icon my-org-drag-handle' });
            obsidian.setIcon(dragHandle, 'menu');
            obsidian.setTooltip(dragHandle, 'Drag to reorder');
            dragHandle.style.cursor = 'grab';

            // Drag tracking must bind to the settings window (a popout in 1.13), not the main window
            const dragWin = (dragHandle.ownerDocument && dragHandle.ownerDocument.defaultView) || window;

            const collapseBtn = headerSetting.nameEl.createSpan({ cls: 'my-org-collapse-icon clickable-icon' });
            obsidian.setIcon(collapseBtn, isCollapsed ? 'chevron-right' : 'chevron-down');
            collapseBtn.onclick = async () => {
                this.plugin.settings.collapsedSettingGroups[index] = !isCollapsed;
                await this.plugin.saveSettings(false);
                this.displayPreservingScroll();
            };

            const onPointerMove = (pe) => {
                listContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                    el.classList.remove('drop-target-above', 'drop-target-below');
                });

                let closestRow = null;
                let closestDist = Infinity;
                const rows = Array.from(listContainer.querySelectorAll('.my-org-group-draggable-row'));

                rows.forEach(r => {
                    const rect = r.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const dist = Math.abs(pe.clientY - midY);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestRow = r;
                    }
                });

                if (closestRow) {
                    const rect = closestRow.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (pe.clientY < midY) {
                        closestRow.classList.add('drop-target-above');
                    } else {
                        closestRow.classList.add('drop-target-below');
                    }
                }

                // Auto-scrolls vertical settings tab when mouse is near container edges
                const scrollTarget = containerEl.closest('.vertical-tab-content') || containerEl;
                const scrollRect = scrollTarget.getBoundingClientRect();
                const threshold = 50;
                if (pe.clientY - scrollRect.top < threshold) {
                    scrollTarget.scrollTop -= 8;
                } else if (scrollRect.bottom - pe.clientY < threshold) {
                    scrollTarget.scrollTop += 8;
                }
            };

            const onPointerUp = async (pe) => {
                div.classList.remove('is-dragging');
                listContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                    el.classList.remove('drop-target-above', 'drop-target-below');
                });

                let closestRow = null;
                let closestDist = Infinity;
                let closestIndex = -1;
                const rows = Array.from(listContainer.querySelectorAll('.my-org-group-draggable-row'));

                rows.forEach((r, idx) => {
                    const rect = r.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const dist = Math.abs(pe.clientY - midY);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestRow = r;
                        closestIndex = idx;
                    }
                });

                if (closestRow && closestIndex !== -1) {
                    const fromIndex = this.draggedGroupIndex;
                    let toIndex = closestIndex;
                    const rect = closestRow.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;

                    if (pe.clientY >= midY) toIndex++;
                    if (fromIndex < toIndex) toIndex--;

                    if (fromIndex !== toIndex) {
                        const itemToMove = this.plugin.settings.groups.splice(fromIndex, 1)[0];
                        this.plugin.settings.groups.splice(toIndex, 0, itemToMove);

                        const indexMap = Array.from({ length: this.plugin.settings.groups.length }, (_, i) => i);
                        const idxToMove = indexMap.splice(fromIndex, 1)[0];
                        indexMap.splice(toIndex, 0, idxToMove);

                        const oldCollapsedGroups = { ...this.plugin.settings.collapsedGroups };
                        const oldCollapsedSettingGroups = { ...this.plugin.settings.collapsedSettingGroups };

                        const newCollapsedGroups = {};
                        const newCollapsedSettingGroups = {};

                        if (oldCollapsedGroups['Ungrouped'] !== undefined) {
                            newCollapsedGroups['Ungrouped'] = oldCollapsedGroups['Ungrouped'];
                        }

                        indexMap.forEach((oldIndex, newIndex) => {
                            if (oldCollapsedGroups[oldIndex] !== undefined) {
                                newCollapsedGroups[newIndex] = oldCollapsedGroups[oldIndex];
                            }
                            if (oldCollapsedSettingGroups[oldIndex] !== undefined) {
                                newCollapsedSettingGroups[newIndex] = oldCollapsedSettingGroups[oldIndex];
                            }
                        });

                        this.plugin.settings.collapsedGroups = newCollapsedGroups;
                        this.plugin.settings.collapsedSettingGroups = newCollapsedSettingGroups;

                        await this.plugin.saveSettings();
                        this.displayPreservingScroll();
                    }
                }

                this.draggedGroupIndex = null;
                dragWin.removeEventListener('pointermove', onPointerMove);
                dragWin.removeEventListener('pointerup', onPointerUp);
            };

            dragHandle.addEventListener('pointerdown', (pe) => {
                pe.preventDefault();
                this.draggedGroupIndex = index;
                div.classList.add('is-dragging');

                dragWin.addEventListener('pointermove', onPointerMove);
                dragWin.addEventListener('pointerup', onPointerUp);
            });


            let headerBadge = null;
            if (isCollapsed) {
                const titleSpan = headerSetting.nameEl.createSpan({ text: group.title });
                titleSpan.style.color = 'var(--text-muted)';
                titleSpan.style.fontWeight = 'normal';

                headerBadge = headerSetting.nameEl.createSpan({ cls: 'my-org-match-badge' });
                this.bindBadgeHoverLogic(headerBadge);
            }

            headerSetting.addExtraButton(b => {
                const isLocked = group.isLocked || false;
                b.setIcon(isLocked ? 'lock' : 'unlock')
                    .setTooltip(isLocked ? 'Unlock to allow new plugins' : 'Lock to prevent new matches');
                if (isLocked) b.extraSettingsEl.style.color = 'var(--interactive-accent)';
                b.onClick(async () => {
                    const willBeLocked = !group.isLocked;
                    if (willBeLocked) {
                        // Snapshot current keyword matches before setting isLocked,
                        // so recalculateAllMatches uses keyword logic (not the locked state)
                        const matchesMap = recalculateAllMatches();
                        const matchedIds = [];
                        Object.values(matchesMap).forEach(p => {
                            if (p.groupIndices.includes(index)) {
                                matchedIds.push(p.id);
                            }
                        });
                        group.lockedPluginIds = matchedIds;
                    } else {
                        group.lockedPluginIds = [];
                    }
                    group.isLocked = willBeLocked;
                    await this.plugin.saveSettings();
                    this.displayPreservingScroll();
                });
            });

            headerSetting.addExtraButton(b => {
                b.setIcon('pencil')
                    .setTooltip('Manage matched plugins')
                    .onClick(() => {
                        new GroupConfigModal(this.app, this.plugin, index, () => {
                            this.displayPreservingScroll();
                        }).open();
                    });
            });



            headerSetting.addExtraButton(b => b.setIcon('trash').setTooltip('Delete group').onClick(async () => {
                const deleteAction = async () => {
                    this.plugin.settings.groups.splice(index, 1);

                    const newCollapsedGroups = {};
                    const newCollapsedSettingGroups = {};

                    if (this.plugin.settings.collapsedGroups['Ungrouped'] !== undefined) {
                        newCollapsedGroups['Ungrouped'] = this.plugin.settings.collapsedGroups['Ungrouped'];
                    }
                    this.plugin.settings.groups.forEach((g, i) => {
                        let oldIndex = i >= index ? i + 1 : i;
                        if (this.plugin.settings.collapsedGroups[oldIndex] !== undefined) {
                            newCollapsedGroups[i] = this.plugin.settings.collapsedGroups[oldIndex];
                        }
                        if (this.plugin.settings.collapsedSettingGroups[oldIndex] !== undefined) {
                            newCollapsedSettingGroups[i] = this.plugin.settings.collapsedSettingGroups[oldIndex];
                        }
                    });
                    this.plugin.settings.collapsedGroups = newCollapsedGroups;
                    this.plugin.settings.collapsedSettingGroups = newCollapsedSettingGroups;

                    await this.plugin.saveSettings();

                    this.plugin.deleteGracePeriod = true;
                    if (this.plugin.gracePeriodTimer) clearTimeout(this.plugin.gracePeriodTimer);
                    this.plugin.gracePeriodTimer = setTimeout(() => {
                        this.plugin.deleteGracePeriod = false;
                    }, 15000);

                    this.displayPreservingScroll();
                };

                if (this.plugin.deleteGracePeriod) {
                    await deleteAction();
                } else {
                    new DeleteConfirmModal(this.app, group.title, deleteAction).open();
                }
            }));

            const contentDiv = div.createDiv();
            if (isCollapsed) contentDiv.style.display = 'none';

            new obsidian.Setting(contentDiv).setName('Title').addText(t => {
                t.setValue(group.title).onChange(async v => {
                    this.plugin.settings.groups[index].title = v;
                    await this.plugin.saveSettings();
                });

                t.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                        e.preventDefault();
                        const textarea = contentDiv.querySelector('.my-org-keywords-input');
                        if (textarea) textarea.focus();
                    }
                });
            });

            const kwSetting = new obsidian.Setting(contentDiv).setName('Keywords');

            kwSetting.addExtraButton(b => {
                b.setIcon('plus-circle').setTooltip('Add plugin').onClick(() => {
                    const currentMatches = badge.tooltipDataObject || [];
                    const matchedPluginIds = currentMatches.map(p => p.id);
                    new AddPluginByKeywordModal(this.app, this.plugin, group.title, matchedPluginIds, async (pluginItem) => {
                        let updatedText = this.plugin.settings.groups[index].keywords || '';
                        if (updatedText.trim().length > 0) {
                            updatedText += `, ${pluginItem.name}`;
                        } else {
                            updatedText = pluginItem.name;
                        }
                        this.plugin.settings.groups[index].keywords = updatedText;

                        if (this.plugin.settings.groups[index].isLocked) {
                            if (!this.plugin.settings.groups[index].lockedPluginIds) {
                                this.plugin.settings.groups[index].lockedPluginIds = [];
                            }
                            if (!this.plugin.settings.groups[index].lockedPluginIds.includes(pluginItem.id)) {
                                this.plugin.settings.groups[index].lockedPluginIds.push(pluginItem.id);
                            }
                        }

                        const textarea = contentDiv.querySelector('.my-org-keywords-input');
                        if (textarea) textarea.value = updatedText;

                        const newMatchesMap = recalculateAllMatches();
                        badgeUpdaters.forEach(updater => updater(newMatchesMap));
                        await this.plugin.saveSettings();
                        this.plugin.checkAndApply();
                    }).open();
                });
                b.extraSettingsEl.classList.add('my-org-large-add-btn');
            });

            const badge = kwSetting.nameEl.createSpan({ cls: 'my-org-match-badge' });
            this.bindBadgeHoverLogic(badge);

            const updateBadge = (currentMatchesMap) => {
                const groupMatches = [];
                Object.values(currentMatchesMap).forEach(p => {
                    const matchData = p.groupsMap && p.groupsMap[index];
                    if (matchData && matchData.posMatch && !matchData.isExcluded) {
                        groupMatches.push({
                            id: p.id,
                            manifestName: p.manifestName,
                            uiName: p.uiName !== p.manifestName ? p.uiName : null,
                            hasUI: p.hasUI,
                            otherGroups: p.groups.filter((t, i) => p.groupIndices[i] !== index),
                            matchData: matchData
                        });
                    }
                });

                const savedOrder = group.items ? group.items.map(i => i.id || i.name) : [];

                groupMatches.sort((a, b) => {
                    const nameA = a.manifestName;
                    const nameB = b.manifestName;

                    let indexA = savedOrder.indexOf(a.id);
                    if (indexA === -1) indexA = savedOrder.indexOf(nameA);

                    let indexB = savedOrder.indexOf(b.id);
                    if (indexB === -1) indexB = savedOrder.indexOf(nameB);

                    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                    if (indexA !== -1) return -1;
                    if (indexB !== -1) return 1;

                    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                });

                badge.tooltipDataObject = groupMatches;
                const activeCount = groupMatches.length;
                badge.innerText = `${activeCount} matches ⓘ`;

                if (headerBadge) {
                    headerBadge.tooltipDataObject = groupMatches;
                    headerBadge.innerText = `${activeCount} matches ⓘ`;
                }
            };

            badgeUpdaters.push(updateBadge);

            kwSetting.addTextArea(t => {
                t.inputEl.classList.add('my-org-keywords-input');
                t.setValue(group.keywords).onChange(async v => {
                    this.plugin.settings.groups[index].keywords = v;
                    const newMatchesMap = recalculateAllMatches();
                    badgeUpdaters.forEach(update => update(newMatchesMap));
                    await this.plugin.saveSettings(true);
                });
            });
        });

        // Renders the initial states for all badges on page load
        const initialMatchesMap = recalculateAllMatches();
        badgeUpdaters.forEach(update => update(initialMatchesMap));

        const btnDiv = containerEl.createDiv({ cls: 'my-org-add-group-container' });
        const btn = btnDiv.createEl('button', { text: '+ Add group', cls: 'mod-cta my-org-add-group-btn' });

        btn.onclick = async () => {
            this.plugin.settings.groups.push({ title: 'New Folder', keywords: '', items: [] });
            await this.plugin.saveSettings();
            this.display();

            // Automatically sets cursor to the title of the newly added group
            const titleInputs = containerEl.querySelectorAll('.my-org-group-card input[type="text"]');
            if (titleInputs.length > 0) {
                const lastInput = titleInputs[titleInputs.length - 1];
                lastInput.focus();
                lastInput.select();
            }
        };
    }
}

class DeleteConfirmModal extends obsidian.Modal {
    constructor(app, groupName, onConfirm) {
        super(app);
        this.groupName = groupName;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Delete Group' });
        contentEl.createEl('p', { text: `Are you sure you want to delete the group "${this.groupName}"?` });
        contentEl.createEl('p', {
            text: 'Note: For the next 15 seconds, subsequent group deletions will not require confirmation.',
            cls: 'my-org-modal-desc'
        });

        const btnDiv = contentEl.createDiv({ cls: 'my-org-modal-actions' });

        const cancelBtn = btnDiv.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = btnDiv.createEl('button', { text: 'Delete group', cls: 'mod-warning' });
        confirmBtn.onclick = () => {
            this.onConfirm();
            this.close();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class AddPluginByKeywordModal extends obsidian.Modal {
    constructor(app, plugin, groupTitle, matchedPluginIds, onAdd) {
        super(app);
        this.plugin = plugin;
        this.groupTitle = groupTitle;
        this.matchedPluginIds = matchedPluginIds;
        this.onAdd = onAdd;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Add plugin to ${this.groupTitle}` });

        const allPlugins = [];
        const installedIds = Object.keys(this.app.plugins.manifests);

        installedIds.forEach(id => {
            if (this.matchedPluginIds.includes(id)) return;

            const manifestName = this.app.plugins.manifests[id].name;

            const globalAlias = this.plugin.getGlobalAlias(id);

            let hasUI = false;
            if (this.app.setting.pluginTabs.some(tab => tab.id === id)) {
                hasUI = true;
            } else if (this.plugin.settings.knownPluginTabs[id]) {
                hasUI = true;
            }

            allPlugins.push({
                id: id,
                name: manifestName,
                alias: globalAlias,
                hasUI: hasUI
            });
        });

        const uiPlugins = allPlugins.filter(p => p.hasUI).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        const noUiPlugins = allPlugins.filter(p => !p.hasUI).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        this.listContainer = contentEl.createDiv({ cls: 'my-org-modal-list' });

        const renderList = (title, items) => {
            if (items.length === 0) return;

            if (title === 'Plugins without a settings menu' && uiPlugins.length > 0) {
                this.listContainer.createEl('hr', { cls: 'my-org-modal-divider' });
            }

            const headerRow = this.listContainer.createDiv({ cls: 'my-org-toolbar-row' });
            const leftDiv = headerRow.createDiv({ cls: 'my-org-toolbar-left' });
            leftDiv.createDiv({ cls: 'my-org-tt-header-title', text: `${title} (${items.length})` });

            items.forEach((item, index) => {
                const row = this.listContainer.createDiv({ cls: 'my-org-modal-item' });

                const infoDiv = row.createDiv({ cls: 'my-org-add-plugin-info' });

                infoDiv.createSpan({ cls: 'my-org-add-plugin-name', text: item.name });

                infoDiv.createSpan({ cls: 'my-org-add-plugin-separator', text: '|' });

                if (item.alias) {
                    infoDiv.createSpan({ cls: 'my-org-tt-muted', text: `"${item.alias}"` });
                }

                const cleanNoteText = this.plugin.getCleanNote(item.id);
                const noteBtn = infoDiv.createDiv({ cls: `my-org-modal-btn my-org-note-btn ${cleanNoteText ? 'has-note' : ''}` });
                obsidian.setIcon(noteBtn, 'file-text');

                this.plugin.addCustomTooltip(noteBtn, () => {
                    const text = this.plugin.getCleanNote(item.id);
                    if (text) return text;
                    const fallback = (noteBtn.ownerDocument || document).createElement('div');
                    fallback.className = 'my-org-note-fallback';
                    fallback.innerText = "Click to add note";
                    return fallback;
                }, { position: 'top', extraClass: 'my-org-note-tooltip', alwaysShow: true });

                noteBtn.onclick = () => {
                    new PluginNoteModal(this.app, item, this.plugin, () => {
                        this.onOpen();
                    }).open();
                };

                const ctrls = row.createDiv({ cls: 'my-org-modal-controls' });

                const addBtn = ctrls.createDiv({ cls: 'clickable-icon' });
                obsidian.setIcon(addBtn, 'plus-circle');
                this.plugin.addCustomTooltip(addBtn, "Add to keywords", { position: 'top' });

                addBtn.onclick = () => {
                    row.remove();
                    this.onAdd(item);
                };
            });
        };

        if (allPlugins.length === 0) {
            this.listContainer.createDiv({ text: 'All installed plugins are already assigned to this group.', cls: 'my-org-modal-empty' });
        } else {
            renderList('Plugins with a settings menu', uiPlugins);
            renderList('Plugins without a settings menu', noUiPlugins);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

class PluginNoteModal extends obsidian.Modal {
    constructor(app, pluginData, pluginInstance, onSave) {
        super(app);
        this.pluginData = pluginData;
        this.pluginInstance = pluginInstance;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Notes: ${this.pluginData.name}` });

        const textArea = contentEl.createEl('textarea', { cls: 'my-org-note-textarea' });
        textArea.placeholder = "Write your thoughts about this plugin...";
        const rawNote = this.pluginInstance.settings.pluginNotes[this.pluginData.id] || '';
        this.htmlComments = [];
        const cleanNote = rawNote.replace(/<!--[\s\S]*?-->/g, (match) => {
            this.htmlComments.push(match);
            return '';
        }).trim();

        textArea.value = cleanNote;

        const actions = contentEl.createDiv({ cls: 'my-org-modal-actions' });

        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const manifest = this.app.plugins.manifests[this.pluginData.id];
        if (manifest && manifest.description) {
            const appendBtn = actions.createEl('button', { text: 'Append description' });
            appendBtn.onclick = () => {
                const currentVal = textArea.value.trim();
                textArea.value = currentVal ? currentVal + '\n\n' + manifest.description : manifest.description;
            };
        }

        const saveBtn = actions.createEl('button', { text: 'Save note', cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            let note = textArea.value.trim();
            if (this.htmlComments && this.htmlComments.length > 0) {
                note = this.htmlComments.join('\n') + '\n\n' + note;
                note = note.trim();
            }
            if (!this.pluginInstance.settings.noteTimestamps) {
                this.pluginInstance.settings.noteTimestamps = {};
            }
            if (note) {
                this.pluginInstance.settings.pluginNotes[this.pluginData.id] = note;
                this.pluginInstance.settings.noteTimestamps[this.pluginData.id] = Date.now();
            } else {
                delete this.pluginInstance.settings.pluginNotes[this.pluginData.id];
                delete this.pluginInstance.settings.noteTimestamps[this.pluginData.id];
            }
            await this.pluginInstance.saveSettings(false);
            await this.pluginInstance.saveNotesToFile();
            this.onSave();
            this.close();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class BulkAppendModal extends obsidian.Modal {
    constructor(app, plugin, onResolve) {
        super(app);
        this.plugin = plugin;
        this.onResolve = onResolve;
        this.pluginList = [];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('my-org-bulk-modal');

        contentEl.createEl('h2', { text: 'Create notes for existing plugins', cls: 'my-org-modal-title' });
        contentEl.createEl('p', {
            text: 'Automatic note creation enabled. You can also generate notes for installed plugins here (only plugins without a note are shown).',
            cls: 'my-org-modal-help-text'
        });

        const listContainer = contentEl.createDiv({ cls: 'my-org-bulk-list' });

        const validManifests = Object.values(this.app.plugins.manifests).filter(manifest => {
            if (!manifest.description) return false;
            const currentNote = this.plugin.settings.pluginNotes[manifest.id] || "";
            if (currentNote.includes(manifest.description)) return false;
            return true;
        });

        validManifests.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        const uiPlugins = validManifests.filter(m => {
            const isEnabled = this.app.plugins.enabledPlugins.has(m.id);
            if (isEnabled) return this.app.setting.pluginTabs.some(t => t.id === m.id);
            return this.plugin.settings.knownPluginTabs[m.id] || false;
        });
        const noUiPlugins = validManifests.filter(m => {
            const isEnabled = this.app.plugins.enabledPlugins.has(m.id);
            if (isEnabled) return !this.app.setting.pluginTabs.some(t => t.id === m.id);
            return !(this.plugin.settings.knownPluginTabs[m.id] || false);
        });

        let acceptBtn;
        let cancelBtn;
        const updateAcceptBtn = () => {
            const selected = this.pluginList.filter(p => p.checkbox.checked);
            if (acceptBtn) {
                acceptBtn.innerText = selected.length > 0 ? 'Apply to selected' : 'I don\'t want to';
            }
            if (cancelBtn) {
                cancelBtn.style.display = selected.length > 0 ? '' : 'none';
            }
        };

        let masterCheckbox;
        if (validManifests.length > 0) {
            const masterContainer = listContainer.createDiv({ cls: 'my-org-bulk-item my-org-bulk-item-master' });
            const masterLabel = masterContainer.createEl('label', { cls: 'my-org-bulk-label' });
            masterCheckbox = masterLabel.createEl('input', { type: 'checkbox' });
            masterCheckbox.checked = false;
            masterLabel.createEl('span', { text: 'Select all', cls: 'my-org-bulk-name my-org-bulk-select-all' });

            masterCheckbox.onchange = () => {
                const checked = masterCheckbox.checked;
                this.pluginList.forEach(p => {
                    p.checkbox.checked = checked;
                });
                updateAcceptBtn();
            };
        }

        const renderSection = (title, manifests) => {
            if (manifests.length === 0) return;

            if (title === 'Plugins without a settings menu' && uiPlugins.length > 0) {
                listContainer.createEl('hr', { cls: 'my-org-modal-divider' });
            }

            const headerRow = listContainer.createDiv({ cls: 'my-org-toolbar-row my-org-bulk-section-header' });
            const leftDiv = headerRow.createDiv({ cls: 'my-org-toolbar-left' });
            leftDiv.createDiv({ cls: 'my-org-tt-header-title', text: `${title} (${manifests.length})` });

            manifests.forEach(manifest => {
                const itemDiv = listContainer.createDiv({ cls: 'my-org-bulk-item' });

                const labelEl = itemDiv.createEl('label', { cls: 'my-org-bulk-label' });
                const checkbox = labelEl.createEl('input', { type: 'checkbox' });
                checkbox.checked = false;

                checkbox.onchange = () => {
                    if (masterCheckbox) {
                        masterCheckbox.checked = this.pluginList.length > 0 && this.pluginList.every(p => p.checkbox.checked);
                    }
                    updateAcceptBtn();
                };

                labelEl.createEl('span', { text: manifest.name, cls: 'my-org-bulk-name' });

                this.pluginList.push({
                    id: manifest.id,
                    manifest: manifest,
                    checkbox: checkbox
                });
            });
        };

        renderSection('Plugins with a settings menu', uiPlugins);
        renderSection('Plugins without a settings menu', noUiPlugins);

        if (this.pluginList.length === 0) {
            listContainer.createDiv({ text: 'All plugins already have their descriptions appended or lack descriptions.', cls: 'my-org-note-fallback my-org-bulk-empty' });
        }

        const actions = contentEl.createDiv({ cls: 'my-org-bulk-actions' });

        cancelBtn = actions.createEl('button', { text: 'Dismiss' });
        cancelBtn.onclick = () => {
            const resolve = this.onResolve;
            this.onResolve = null;
            if (resolve) resolve(false);
            this.close();
        };

        acceptBtn = actions.createEl('button', { text: 'Close', cls: 'mod-cta' });

        acceptBtn.onclick = async () => {
            const selected = this.pluginList.filter(p => p.checkbox.checked);
            if (selected.length > 0) {
                selected.forEach(p => {
                    const currentNote = this.plugin.settings.pluginNotes[p.id] || "";
                    this.plugin.settings.pluginNotes[p.id] = currentNote ? currentNote + '\n\n' + p.manifest.description : p.manifest.description;
                    this.plugin.settings.noteTimestamps[p.id] = Date.now();
                });
                await this.plugin.saveNotesToFile();
                new obsidian.Notice(`Added descriptions to ${selected.length} plugins.`);
            }
            const resolve = this.onResolve;
            this.onResolve = null;
            if (resolve) resolve(true);
            this.close();
        };

        updateAcceptBtn();
    }

    onClose() {
        if (this.onResolve) {
            // Handles cases where modal is closed via ESC or clicking outside
            this.onResolve(false);
            this.onResolve = null;
        }
        this.contentEl.empty();
    }
}