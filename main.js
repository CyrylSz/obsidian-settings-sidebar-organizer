const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    showUngrouped: true,
    collapsibleHeaders: true,
    compactMode: false,
    startCollapsed: false,
    groups: [],
    collapsedSections: [],
    collapsedGroups: {},
    pluginNotes: {} // Added storage for plugin notes
};

module.exports = class SettingsSidebarOrganizerPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new OrganizerSettingTab(this.app, this));

        // Apply dynamic body class for collapsible headers CSS
        document.body.classList.toggle('my-org-collapse-enabled', this.settings.collapsibleHeaders);

        // Flag to prevent infinite loops (Observer -> DOM change -> Observer)
        this.isOrganizing = false;
        // Flag indicating if the observer is currently attached
        this.observing = false;

        // It reacts only to actual DOM changes (node additions/removals).
        this.observer = new MutationObserver((mutations) => {
            if (this.isOrganizing) return;
            const hasNodeChanges = mutations.some(m => m.type === 'childList');
            if (hasNodeChanges) {
                this.checkAndApply();
            }
        });

        this.app.workspace.onLayoutReady(() => {
            this.restoreSectionStates();
            // Start a lightweight interval to check if the settings window is open.
            // If open -> attach Observer and stop checking.
            this.startSidebarWatcher();
        });

        this.registerDomEvent(document, 'click', (evt) => {
            if (!document.querySelector('.modal-container')) return;
            // Kill active states on the proxies when user clicks a NATIVE sidebar item or our custom gear icons
            if (evt.isTrusted && evt.target instanceof Element) {
                const clickedTab = evt.target.closest('.vertical-tab-nav-item');
                const clickedGear = evt.target.closest('.my-org-section-btn');
                if ((clickedTab && !clickedTab.classList.contains('my-org-proxy')) || clickedGear) {
                    document.querySelectorAll('.my-org-proxy.is-active').forEach(p => p.classList.remove('is-active'));
                }
            }

            // Catches the global click and waits for Obsidian to finish rebuilding the Document Object Model
            if (evt.target instanceof Element && (evt.target.closest('.checkbox-container') || evt.target.closest('button'))) {
                if (evt.target.closest('.my-org-wide-modal')) return; // Ignore clicks inside our custom modal to prevent sidebar flickering
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
                    // LANGUAGE INDEPENDENCE: We use the built-in data-section
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
        });

        // Listen to all scroll actions in the capture phase to clear floating tooltips
        this.registerDomEvent(window, 'scroll', (evt) => {
            if (!document.querySelector('.modal-container')) return;
            if (this.activeTooltip) {
                this.activeTooltip.remove();
                this.activeTooltip = null;
            }
        }, { capture: true });
    }

    // Manages sidebar observation logic
    startSidebarWatcher() {
        // Replace the slow setInterval with an instant MutationObserver on the application body
        this.bodyObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {

                // 1. Detect when the Settings window is opened (added to the Document Object Model)
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.classList.contains('modal-container')) {
                        const sidebar = node.querySelector('.vertical-tab-header-group-items');
                        if (sidebar && !this.observing) {
                            this.observing = true;
                            this.observer.observe(sidebar, { childList: true, subtree: true });
                            this.checkAndApply(); // Apply instantly before the screen paints
                        }
                    }
                });

                // 2. Detect when the Settings window is closed (removed from the Document Object Model)
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.classList.contains('modal-container')) {

                        if (this.activeTooltip) {
                            this.activeTooltip.remove();
                            this.activeTooltip = null;
                        }

                        if (node.querySelector('.vertical-tab-header-group-items')) {
                            if (this.observing) {
                                this.observer.disconnect();
                                this.observing = false;
                            }

                            // INSTANT COLLAPSE LOGIC
                            if (this.settings.startCollapsed) {
                                this.settings.collapsedGroups = {};
                                this.saveSettings(false);

                                // Obsidian caches the closed modal in memory.
                                // We must strip the 'open' state from the detached HTML right now, 
                                // so there is no visual flash when the user reopens the settings!
                                node.querySelectorAll('.my-org-folder').forEach(folder => {
                                    folder.removeAttribute('open');
                                });
                            }
                        }
                    }
                });
            });
        });

        // Start observing the main application body for the settings modal
        this.bodyObserver.observe(document.body, { childList: true });

        // Initial fallback check in case settings are already open when plugin loads
        const sidebar = document.querySelector('.vertical-tab-header-group-items');
        if (sidebar && !this.observing) {
            this.observing = true;
            this.observer.observe(sidebar, { childList: true, subtree: true });
            this.checkAndApply();
        }
    }

    onunload() {
        if (this.observer) this.observer.disconnect();
        if (this.bodyObserver) this.bodyObserver.disconnect();
        if (this.clickTimer) clearTimeout(this.clickTimer); // Clear pending timers

        document.body.classList.remove('my-org-collapse-enabled');

        document.querySelectorAll('.my-org-folder').forEach(f => f.remove());
        document.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));

        // Target ONLY settings modal headers to prevent breaking Obsidian's native file explorer!
        document.querySelectorAll('.vertical-tab-header-group-title.is-collapsed, .vertical-tab-header-group-items.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));

        document.querySelectorAll('.my-org-hide-nav').forEach(el => el.classList.remove('my-org-hide-nav'));
        document.querySelectorAll('.my-org-section-btn').forEach(btn => btn.remove());

        // Clean up floating tooltips
        document.querySelectorAll('.my-org-custom-tooltip').forEach(t => t.remove());
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(shouldReorganize = true) {
        await this.saveData(this.settings);
        if (shouldReorganize) {
            document.querySelectorAll('.my-org-folder').forEach(f => f.remove());
            document.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));
            this.checkAndApply();
        }
    }

    restoreSectionStates() {
        if (!this.settings.collapsibleHeaders) return;
        const headers = document.querySelectorAll('.vertical-tab-header-group-title');
        headers.forEach(header => {
            const group = header.parentElement;
            const items = group.querySelector('.vertical-tab-header-group-items');
            if (items) {
                // Read the safe section ID
                const sectionId = items.getAttribute('data-section') || header.innerText.trim();
                if (this.settings.collapsedSections.includes(sectionId)) {
                    header.classList.add('is-collapsed');
                    items.classList.add('is-collapsed');
                }
            }
        });
    }

    manageCompactMode() {
        if (this.settings.compactMode) {
            // Search by immutable setting IDs (language independent)
            const coreNav = document.querySelector('.vertical-tab-nav-item[data-setting-id="plugins"]');
            const commNav = document.querySelector('.vertical-tab-nav-item[data-setting-id="community-plugins"]');
            const targetNavItems = [coreNav, commNav].filter(Boolean);

            const coreSection = document.querySelector('.vertical-tab-header-group-items[data-section="core-plugins"]');
            const commSection = document.querySelector('.vertical-tab-header-group-items[data-section="community-plugins"]');

            const targetHeaders = [];
            if (coreSection && coreSection.previousElementSibling) targetHeaders.push(coreSection.previousElementSibling);
            if (commSection && commSection.previousElementSibling) targetHeaders.push(commSection.previousElementSibling);

            targetNavItems.forEach(item => {
                item.classList.add('my-org-hide-nav');
            });

            targetHeaders.forEach(header => {
                if (header.querySelector('.my-org-section-btn')) return;

                const btn = document.createElement('div');
                btn.className = 'my-org-section-btn';
                btn.setAttribute('aria-label', 'Manage plugins');
                obsidian.setIcon(btn, 'settings');

                btn.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    // Manually clear proxy active states because stopPropagation blocks the global listener
                    document.querySelectorAll('.my-org-proxy.is-active').forEach(p => p.classList.remove('is-active'));

                    // Connect the gear icon with the hidden menu button
                    if (header === (coreSection && coreSection.previousElementSibling) && coreNav) {
                        coreNav.click();
                    } else if (header === (commSection && commSection.previousElementSibling) && commNav) {
                        commNav.click();
                    }
                };
                header.appendChild(btn);
            });
        } else {
            document.querySelectorAll('.my-org-hide-nav').forEach(item => item.classList.remove('my-org-hide-nav'));
            document.querySelectorAll('.my-org-section-btn').forEach(b => b.remove());
        }
    }

    checkAndApply() {
        const sidebar = document.querySelector('.vertical-tab-header-group-items');
        if (!sidebar) return;

        // Restore collapse if needed
        if (this.settings.collapsibleHeaders) {
            this.restoreSectionStates();
        }

        this.organizeSidebar();
        this.manageCompactMode();
    }

    organizeSidebar() {
        // Set flag to indicate internal DOM modification so the Observer ignores us
        this.isOrganizing = true;

        if (!this.app.plugins || !this.app.plugins.manifests) {
            this.isOrganizing = false;
            return;
        }

        let targetContainer = document.querySelector('.vertical-tab-header-group-items[data-section="community-plugins"]');

        if (!targetContainer) {
            const firstCommunityPlugin = document.querySelector('.vertical-tab-nav-item[data-setting-id]');
            if (firstCommunityPlugin) {
                targetContainer = firstCommunityPlugin.parentElement;
            }
        }

        if (!targetContainer) {
            this.isOrganizing = false;
            return;
        }

        // Clean up
        targetContainer.querySelectorAll('.my-org-folder').forEach(el => el.remove());
        targetContainer.querySelectorAll('.my-org-hidden').forEach(el => el.classList.remove('my-org-hidden'));

        const pluginItems = Array.from(targetContainer.querySelectorAll('.vertical-tab-nav-item'));

        // Prepare Groups
        const groupsMap = this.settings.groups.map(g => {
            const details = document.createElement('details');
            details.className = 'my-org-folder';
            const savedState = this.settings.collapsedGroups[g.title];
            const isOpen = savedState !== undefined ? savedState : !this.settings.startCollapsed;
            details.open = isOpen;

            // Creating element safely
            details.createEl('summary', { cls: 'my-org-summary', text: g.title });

            details.addEventListener('toggle', () => {
                this.settings.collapsedGroups[g.title] = details.open;
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

        const ungroupedDetails = document.createElement('details');
        ungroupedDetails.className = 'my-org-folder my-org-special';
        const savedUngroupedState = this.settings.collapsedGroups['Ungrouped'];
        ungroupedDetails.open = savedUngroupedState !== undefined ? savedUngroupedState : !this.settings.startCollapsed;
        ungroupedDetails.addEventListener('toggle', () => {
            this.settings.collapsedGroups['Ungrouped'] = ungroupedDetails.open;
            this.saveSettings(false);
        });
        const ungroupedSummary = document.createElement('summary');
        ungroupedSummary.className = 'my-org-summary';
        ungroupedSummary.innerText = 'Ungrouped';
        ungroupedDetails.appendChild(ungroupedSummary);

        let ungroupedCount = 0;
        let foldersInserted = false;

        pluginItems.forEach(item => {
            const uiName = item.innerText.trim();
            const settingId = item.getAttribute('data-setting-id');
            const manifest = settingId ? this.app.plugins.manifests[settingId] : null;

            // Ensure it's a valid community plugin
            if (!manifest) return;
            const manifestName = manifest.name;

            if (item.classList.contains('my-org-hidden')) return;

            if (!foldersInserted) {
                groupsMap.forEach(g => targetContainer.insertBefore(g.element, item));
                if (this.settings.showUngrouped) targetContainer.insertBefore(ungroupedDetails, item);
                foldersInserted = true;
            }

            let matchedCount = 0;
            for (const group of groupsMap) {
                // Match against the official manifest name to ensure consistency with the settings modal
                if (group.keywords.some(k => manifestName.toLowerCase().includes(k) || uiName.toLowerCase().includes(k))) {

                    // Look up configuration using the official manifest name
                    const config = group.items.find(i => i.name === manifestName);

                    // Fallback to the User Interface name if no alias is set
                    const displayName = (config && config.alias) ? config.alias : uiName;

                    // Pass the settingId instead of text for 100% reliable clicking
                    const proxy = this.createProxy(displayName, settingId, item, targetContainer);
                    group.element.appendChild(proxy);

                    // Push manifestName so manual sorting arrays match perfectly
                    group.proxies.push({ name: manifestName, element: proxy });

                    matchedCount++;
                }
            }

            if (matchedCount > 0) {
                item.classList.add('my-org-hidden');
            } else {
                if (this.settings.showUngrouped) {
                    const proxy = this.createProxy(uiName, settingId, item, targetContainer);
                    ungroupedDetails.appendChild(proxy);
                    ungroupedCount++;
                    item.classList.add('my-org-hidden');
                } else {
                    item.classList.add('my-org-hidden');
                }
            }
        });

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

        // Reset flag instantly after operation completes and clear pending observer queue
        if (this.observer) this.observer.takeRecords();
        this.isOrganizing = false;
    }

    createProxy(displayName, settingId, originalItem, container) {
        const proxy = document.createElement('div');
        proxy.className = 'my-org-proxy';
        proxy.innerText = displayName;
        proxy.setAttribute('data-setting-id', settingId);

        // Check if originalItem is still in the Document Object Model and active for initial styling
        if (originalItem && originalItem.classList.contains('is-active')) {
            proxy.classList.add('is-active');
        }

        proxy.onclick = (e) => {
            e.stopPropagation();

            // Immediate visual feedback for responsiveness
            container.querySelectorAll('.my-org-proxy').forEach(p => p.classList.remove('is-active'));
            container.querySelectorAll(`.my-org-proxy[data-setting-id="${settingId}"]`).forEach(p => p.classList.add('is-active'));

            // Find the current live element using the exact setting ID attribute
            const freshTarget = container.querySelector(`.vertical-tab-nav-item[data-setting-id="${settingId}"]:not(.my-org-proxy)`);

            if (freshTarget) {
                freshTarget.click();
            } else {
                // Fallback to original reference if the fresh element isn't found
                if (originalItem) originalItem.click();
            }
        };
        return proxy;
    }
}

class GroupConfigModal extends obsidian.Modal {
    constructor(app, plugin, groupIndex) {
        super(app);
        this.plugin = plugin;
        this.groupIndex = groupIndex;
        this.group = this.plugin.settings.groups[groupIndex];
        this.listContainer = null;

        // State tracking for the Master Toggle and individual switches
        this.initialStates = {};
        this.pendingStates = {};
    }

    checkForChanges() {
        const isItemsChanged = JSON.stringify(this.originalItems) !== JSON.stringify(this.items);
        const isStateChanged = Object.keys(this.pendingStates).some(id => this.pendingStates[id] !== this.initialStates[id]);
        if (this.saveBtn) this.saveBtn.disabled = !(isItemsChanged || isStateChanged);
    }

    updateSaveState() {
        if (this.saveBtn) {
            this.saveBtn.disabled = !this.hasChanges;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        new obsidian.Setting(contentEl)
            .setName(`Matched plugins in ${this.group.title}`)
            .setDesc('Reorder, toggle, rename and write notes.')
            .setHeading();

        this.initialStates = {};
        this.pendingStates = {};

        this.modalEl.classList.add('my-org-wide-modal');

        const keywords = this.group.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        const allPluginsMap = this.app.plugins && this.app.plugins.manifests ? this.app.plugins.manifests : {};
        const matchedPlugins = [];

        Object.keys(allPluginsMap).forEach(id => {
            const manifest = allPluginsMap[id];
            const tab = this.app.setting.pluginTabs?.find(t => t.id === id);
            const uiName = tab ? tab.name : manifest.name;
            const isEnabled = this.app.plugins.enabledPlugins.has(id);

            let currentItems = this.group.items || [];
            const existingItem = currentItems.find(i => i.id === id || i.name === manifest.name);

            // Critical fix: Disabled plugins don't have active tabs, but we must remember if they have a UI
            const hasUI = isEnabled ? !!tab : (existingItem && existingItem.hasUI !== undefined ? existingItem.hasUI : false);

            if (keywords.some(k => manifest.name.toLowerCase().includes(k) || uiName.toLowerCase().includes(k))) {
                matchedPlugins.push({ id, name: manifest.name, uiName, hasUI });
            }
        });

        let currentItems = this.group.items || [];
        this.list1 = [];
        this.list2 = [];
        const newlyAddedList1 = [];

        matchedPlugins.forEach(p => {
            const existing = currentItems.find(i => i.name === p.name);
            const isEnabled = this.app.plugins.enabledPlugins.has(p.id);

            // UI presence dynamically verified or restored from memory
            if (p.hasUI) {
                if (!existing) {
                    newlyAddedList1.push({ name: p.name, id: p.id, alias: '', hasUI: true });
                }
            } else {
                this.list2.push(p);
            }

            this.initialStates[p.id] = isEnabled;
            this.pendingStates[p.id] = isEnabled;
        });

        // Reconstruct list1 in the saved custom order
        currentItems.forEach(existingItem => {
            const stillMatchesAndHasUI = matchedPlugins.find(p => p.name === existingItem.name && p.hasUI);
            if (stillMatchesAndHasUI) {
                existingItem.id = stillMatchesAndHasUI.id; // Update ID just in case
                existingItem.hasUI = true; // Ensure explicitly saved
                this.list1.push(existingItem);
            }
        });

        // Sort newly added items alphabetically (case insensitive) and append to list1
        newlyAddedList1.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.list1.push(...newlyAddedList1);

        this.list2.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.originalItems = JSON.parse(JSON.stringify(this.list1));
        this.items = JSON.parse(JSON.stringify(this.list1));

        // Prevent Obsidian's auto-focus from highlighting the sort select menu or inputs
        setTimeout(() => {
            const active = document.activeElement;
            if (active && (active.tagName === 'SELECT' || active.tagName === 'INPUT')) {
                active.blur();
            }
        }, 10);

        this.listContainer = contentEl.createDiv({ cls: 'my-org-modal-list' });

        // Global drop zone logic to capture drops even in gaps between elements
        this.listContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this.draggedIndex === null || this.draggedIndex === undefined) return;

            this.listContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                el.classList.remove('drop-target-above', 'drop-target-below');
            });

            let closestRow = null;
            let closestDist = Infinity;
            const rows = Array.from(this.listContainer.querySelectorAll('.my-org-draggable-row'));

            rows.forEach(r => {
                const rect = r.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const dist = Math.abs(e.clientY - midY);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestRow = r;
                }
            });

            if (closestRow) {
                const rect = closestRow.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    closestRow.classList.add('drop-target-above');
                } else {
                    closestRow.classList.add('drop-target-below');
                }
            }
        });

        this.listContainer.addEventListener('dragleave', (e) => {
            if (e.target === this.listContainer) {
                this.listContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                    el.classList.remove('drop-target-above', 'drop-target-below');
                });
            }
        });

        this.listContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggedIndex === null || this.draggedIndex === undefined) return;

            this.listContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                el.classList.remove('drop-target-above', 'drop-target-below');
            });

            let closestRow = null;
            let closestDist = Infinity;
            let closestIndex = -1;
            const rows = Array.from(this.listContainer.querySelectorAll('.my-org-draggable-row'));

            rows.forEach((r, idx) => {
                const rect = r.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const dist = Math.abs(e.clientY - midY);
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

                if (e.clientY >= midY) toIndex++;
                if (fromIndex < toIndex) toIndex--;

                if (fromIndex !== toIndex) {
                    const itemToMove = this.items.splice(fromIndex, 1)[0];
                    this.items.splice(toIndex, 0, itemToMove);
                    this.checkForChanges();
                    this.renderList();
                }
            }
            this.draggedIndex = null;
        });

        this.renderList();

        const btnDiv = contentEl.createDiv({ cls: 'my-org-modal-actions my-org-actions-centered' });
        this.saveBtn = btnDiv.createEl('button', { text: 'Save changes', cls: 'mod-cta' });
        this.saveBtn.disabled = true;
        this.saveBtn.onclick = async () => {
            this.plugin.settings.groups[this.groupIndex].items = this.items;
            
            // Just save data, don't rebuild UI yet because we are about to block the thread
            await this.plugin.saveSettings(false);

            let stateChanged = false;
            for (const [id, willEnable] of Object.entries(this.pendingStates)) {
                const wasEnabled = this.initialStates[id];
                if (willEnable && !wasEnabled) {
                    this.app.plugins.enabledPlugins.add(id);
                    await this.app.plugins.enablePlugin(id);
                    stateChanged = true;
                } else if (!willEnable && wasEnabled) {
                    this.app.plugins.enabledPlugins.delete(id);
                    await this.app.plugins.disablePlugin(id);
                    stateChanged = true;
                }
            }

            if (this.app.plugins.requestSave) this.app.plugins.requestSave();

            this.close();

            // Refresh the sidebar layout natively in ONE synchronous step to prevent flashes
            document.querySelectorAll('.my-org-folder').forEach(f => f.remove());
            document.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));
            this.plugin.checkAndApply();
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

                // Enable draggable dynamically on mousedown to allow drag only from the handle
                // This prevents text selection issues in the input while keeping drag-and-drop flawless
                row.addEventListener('mousedown', (e) => {
                    if (dragHandle.contains(e.target)) {
                        row.setAttribute('draggable', 'true');
                    } else {
                        row.removeAttribute('draggable');
                    }
                });

                row.addEventListener('dragstart', (e) => {
                    this.draggedIndex = index;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index);
                    setTimeout(() => row.classList.add('is-dragging'), 0);
                });

                row.addEventListener('dragend', () => {
                    row.removeAttribute('draggable');
                    row.classList.remove('is-dragging');
                    parentContainer.querySelectorAll('.drop-target-above, .drop-target-below').forEach(el => {
                        el.classList.remove('drop-target-above', 'drop-target-below');
                    });
                    this.draggedIndex = null;
                });
            }

            const currentState = this.pendingStates[item.id];

            const toggleEl = ctrls.createDiv({ cls: 'my-org-plugin-toggle' });
            new obsidian.ToggleComponent(toggleEl)
                .setValue(currentState)
                .onChange(val => {
                    this.pendingStates[item.id] = val;
                    this.checkForChanges();

                    const nameNode = row.querySelector('.my-org-modal-item-name');
                    if (nameNode) {
                        if (val) nameNode.classList.remove('is-disabled');
                        else nameNode.classList.add('is-disabled');
                    }
                });

            const nameCls = currentState ? 'my-org-modal-item-name' : 'my-org-modal-item-name is-disabled';
            row.createDiv({ cls: nameCls, text: item.name });

            if (isList1) {
                row.createDiv({ cls: 'my-org-modal-arrow', text: '→' });
                const input = row.createEl('input', { type: 'text', placeholder: 'Alias...' });
                input.value = item.alias || '';
                input.oninput = (e) => {
                    this.items[index].alias = e.target.value;
                    this.checkForChanges();
                };
            }

            const noteText = this.plugin.settings.pluginNotes[item.id];
            const noteBtn = row.createDiv({ cls: `my-org-modal-btn my-org-note-btn ${noteText ? 'has-note' : ''}` });
            obsidian.setIcon(noteBtn, 'file-text');

            noteBtn.addEventListener('mouseenter', () => {
                if (this.plugin.activeTooltip) this.plugin.activeTooltip.remove();
                const tooltipEl = document.createElement('div');
                tooltipEl.className = 'my-org-custom-tooltip my-org-note-tooltip';

                // Show text or a gentle instruction if empty
                if (noteText) {
                    tooltipEl.innerText = noteText;
                } else {
                    tooltipEl.innerText = "Write a note about this plugin...";
                    tooltipEl.style.fontStyle = "italic";
                    tooltipEl.style.opacity = "0.7";
                }

                document.body.appendChild(tooltipEl);
                this.plugin.activeTooltip = tooltipEl;

                const rect = noteBtn.getBoundingClientRect();
                const ttRect = tooltipEl.getBoundingClientRect();
                tooltipEl.style.left = `${rect.left + (rect.width / 2) - (ttRect.width / 2)}px`;
                tooltipEl.style.top = `${rect.top - ttRect.height - 8}px`;
            });

            noteBtn.addEventListener('mouseleave', () => {
                if (this.plugin.activeTooltip) {
                    this.plugin.activeTooltip.remove();
                    this.plugin.activeTooltip = null;
                }
            });

            noteBtn.onclick = () => {
                if (this.plugin.activeTooltip) {
                    this.plugin.activeTooltip.remove();
                    this.plugin.activeTooltip = null;
                }
                new PluginNoteModal(this.app, item, this.plugin, () => {
                    this.renderList();
                }).open();
            };
        };

        if (this.items.length > 0) {
            const headerRow = this.listContainer.createDiv({ cls: 'my-org-toolbar-row' });

            const leftDiv = headerRow.createDiv({ cls: 'my-org-toolbar-left' });
            const headerTitle = leftDiv.createDiv({ text: `Plugins with a settings menu (${this.items.length})` });
            headerTitle.style.whiteSpace = 'nowrap';

            const resetBtn = leftDiv.createDiv({ cls: 'clickable-icon' });
            obsidian.setIcon(resetBtn, 'rotate-ccw');

            resetBtn.addEventListener('mouseenter', () => {
                if (this.plugin.activeTooltip) this.plugin.activeTooltip.remove();
                const tooltipEl = document.createElement('div');
                tooltipEl.className = 'my-org-custom-tooltip';
                tooltipEl.innerText = "Reset aliases and order";
                document.body.appendChild(tooltipEl);
                this.plugin.activeTooltip = tooltipEl;

                const rect = resetBtn.getBoundingClientRect();
                const tipRect = tooltipEl.getBoundingClientRect();
                tooltipEl.style.left = rect.left + (rect.width / 2) - (tipRect.width / 2) + 'px';
                tooltipEl.style.top = rect.bottom + 8 + 'px';
            });
            resetBtn.addEventListener('mouseleave', () => {
                if (this.plugin.activeTooltip) {
                    this.plugin.activeTooltip.remove();
                    this.plugin.activeTooltip = null;
                }
            });
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
            const headerTitle2 = leftDiv2.createDiv({ text: `Plugins without a settings menu (${this.list2.length})` });
            headerTitle2.style.whiteSpace = 'nowrap';

            const rightDiv2 = list2HeaderRow.createDiv({ cls: 'my-org-toolbar-right' });
            rightDiv2.createDiv({ cls: 'my-org-notes-header', text: '' });

            const list2Container = this.listContainer.createDiv({ cls: 'my-org-list2-container' });
            this.list2.forEach((item, index) => createRow(item, index, false, list2Container));
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class OrganizerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();

        new obsidian.Setting(containerEl)
            .setName('Show ungrouped plugins')
            .setDesc('Move plugins that do not match any group into a special "Ungrouped" folder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showUngrouped)
                .onChange(async (value) => {
                    this.plugin.settings.showUngrouped = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Collapsible headers')
            .setDesc('Allow collapsing "Options", "Core plugins", and "Community plugins".')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.collapsibleHeaders)
                .onChange(async (value) => {
                    this.plugin.settings.collapsibleHeaders = value;
                    await this.plugin.saveSettings();
                    if (!value) {
                        document.querySelectorAll('.vertical-tab-header-group-title.is-collapsed, .vertical-tab-header-group-items.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));
                    }
                    document.body.classList.toggle('my-org-collapse-enabled', value);
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

        containerEl.createEl('hr');
        new obsidian.Setting(containerEl).setName('Grouped community plugins').setHeading();

        // Global API scanner to infallibly detect all settings menus
        const recalculateAllMatches = () => {
            const pluginMatches = {};
            const allPluginsMap = this.app.plugins && this.app.plugins.manifests ? this.app.plugins.manifests : {};

            const knownUiStates = {};
            this.plugin.settings.groups.forEach(g => {
                if (g.items) {
                    g.items.forEach(item => {
                        if (item.hasUI) knownUiStates[item.id || item.name] = true;
                    });
                }
            });

            const tabsMap = {};
            if (this.app.setting.pluginTabs) {
                this.app.setting.pluginTabs.forEach(t => tabsMap[t.id] = t);
            }

            Object.keys(allPluginsMap).forEach(id => {
                const manifest = allPluginsMap[id];
                // Deep API check for settings tab registration using optimized map
                const tab = tabsMap[id];

                pluginMatches[id] = {
                    id: id,
                    manifestName: manifest.name,
                    uiName: tab ? tab.name : manifest.name,
                    groups: [],
                    groupIndices: [], // Store precise array indices for bulletproof matching
                    // Trust hardware state first, fallback to our saved persistent memory if disabled
                    hasUI: !!tab || !!knownUiStates[id] || !!knownUiStates[manifest.name]
                };
            });

            this.plugin.settings.groups.forEach((g, idx) => {
                const kws = g.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
                if (kws.length > 0) {
                    Object.keys(pluginMatches).forEach(id => {
                        const p = pluginMatches[id];
                        if (kws.some(k => p.manifestName.toLowerCase().includes(k) || p.uiName.toLowerCase().includes(k))) {
                            p.groups.push(g.title);
                            p.groupIndices.push(idx); // Link matches to specific group index
                        }
                    });
                }
            });
            return pluginMatches;
        };

        // Array to hold the live-update functions for our badges
        const badgeUpdaters = [];

        this.plugin.settings.groups.forEach((group, index) => {
            const div = containerEl.createDiv({ cls: 'my-org-group-card' });

            const headerSetting = new obsidian.Setting(div)
                .setName(`Group ${index + 1}`)
                .setHeading();

            headerSetting.addExtraButton(b => {
                b.setIcon('settings')
                    .setTooltip('Manage matched plugins')
                    .onClick(() => {
                        new GroupConfigModal(this.app, this.plugin, index).open();
                    });
            });

            headerSetting.addExtraButton(b => {
                b.setIcon('arrow-up')
                    .setTooltip('Move group up')
                    .setDisabled(index === 0)
                    .onClick(async () => {
                        if (index > 0) {
                            const temp = this.plugin.settings.groups[index - 1];
                            this.plugin.settings.groups[index - 1] = this.plugin.settings.groups[index];
                            this.plugin.settings.groups[index] = temp;
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    });
                if (index === 0) b.extraSettingsEl.classList.add('my-org-group-arrow-disabled');
            });

            headerSetting.addExtraButton(b => {
                b.setIcon('arrow-down')
                    .setTooltip('Move group down')
                    .setDisabled(index === this.plugin.settings.groups.length - 1)
                    .onClick(async () => {
                        if (index < this.plugin.settings.groups.length - 1) {
                            const temp = this.plugin.settings.groups[index + 1];
                            this.plugin.settings.groups[index + 1] = this.plugin.settings.groups[index];
                            this.plugin.settings.groups[index] = temp;
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    });
                if (index === this.plugin.settings.groups.length - 1) b.extraSettingsEl.classList.add('my-org-group-arrow-disabled');
            });

            headerSetting.addExtraButton(b => b.setIcon('trash').setTooltip('Delete group').onClick(async () => {
                const deleteAction = async () => {
                    this.plugin.settings.groups.splice(index, 1);
                    delete this.plugin.settings.collapsedGroups[group.title];
                    await this.plugin.saveSettings();

                    // Activate 15-second grace period
                    this.plugin.deleteGracePeriod = true;
                    if (this.plugin.gracePeriodTimer) clearTimeout(this.plugin.gracePeriodTimer);
                    this.plugin.gracePeriodTimer = setTimeout(() => {
                        this.plugin.deleteGracePeriod = false;
                    }, 15000);

                    this.display();
                };

                // If within the 15-second grace period, delete immediately; otherwise, show confirmation modal.
                if (this.plugin.deleteGracePeriod) {
                    await deleteAction();
                } else {
                    new DeleteConfirmModal(this.app, group.title, deleteAction).open();
                }
            }));

            new obsidian.Setting(div).setName('Title').addText(t => {
                t.setValue(group.title).onChange(async v => {
                    const oldState = this.plugin.settings.collapsedGroups[this.plugin.settings.groups[index].title];
                    delete this.plugin.settings.collapsedGroups[this.plugin.settings.groups[index].title];
                    if (oldState !== undefined) this.plugin.settings.collapsedGroups[v] = oldState;

                    this.plugin.settings.groups[index].title = v;
                    await this.plugin.saveSettings();
                });

                // Use Tab key for navigation to skip navigation buttons on the right
                t.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                        e.preventDefault(); // Prevent default browser behavior
                        const textarea = div.querySelector('.my-org-keywords-input');
                        if (textarea) textarea.focus();
                    }
                });
            });

            const kwSetting = new obsidian.Setting(div).setName('Keywords');

            // Create Badge
            const badge = kwSetting.nameEl.createSpan({ cls: 'my-org-match-badge' });

            badge.addEventListener('mouseenter', () => {
                if (this.plugin.activeTooltip) this.plugin.activeTooltip.remove();
                const tooltipData = badge.tooltipDataObject;
                if (!tooltipData) return;

                const tooltipEl = document.createElement('div');
                tooltipEl.className = 'my-org-custom-tooltip';

                if (tooltipData.length === 0) {
                    tooltipEl.createDiv({ cls: 'my-org-tt-line', text: 'No plugins match these keywords.' });
                } else {
                    const uiPlugins = [];
                    const noUiPlugins = [];

                    // Instant evaluation of enabled states
                    tooltipData.forEach(item => {
                        const isEnabled = this.plugin.app.plugins.enabledPlugins.has(item.id);
                        const processedItem = { ...item, isEnabled: isEnabled };

                        if (processedItem.hasUI) uiPlugins.push(processedItem);
                        else noUiPlugins.push(processedItem);
                    });

                    // Independent numeration for sections
                    const renderSection = (title, list) => {
                        if (list.length === 0) return;
                        tooltipEl.createDiv({ cls: 'my-org-tt-header', text: title });

                        list.forEach((item, displayIndex) => {
                            const lineCls = item.isEnabled ? 'my-org-tt-line' : 'my-org-tt-line is-disabled';
                            const lineEl = tooltipEl.createDiv({ cls: lineCls });

                            const counter = displayIndex + 1;
                            const space = counter < 10 ? '\u00A0' : '';
                            lineEl.createSpan({ text: `${space}${counter}. ` });

                            lineEl.createSpan({ cls: 'my-org-tt-identifier', text: item.manifestName });

                            if (item.uiName) {
                                lineEl.createSpan({ cls: 'my-org-tt-muted', text: ' (sidebar: ' });
                                lineEl.createSpan({ cls: 'my-org-tt-white', text: item.uiName });
                                lineEl.createSpan({ cls: 'my-org-tt-muted', text: ')' });
                            }

                            if (item.otherGroups.length > 0) {
                                lineEl.createSpan({ cls: 'my-org-tt-others', text: ` (also in: ${item.otherGroups.join(', ')})` });
                            }

                            if (!item.isEnabled) {
                                lineEl.createSpan({ cls: 'my-org-tt-status', text: ' (disabled)' });
                            }
                        });
                    };

                    renderSection('Plugins with a settings menu', uiPlugins);
                    renderSection('Plugins without a settings menu', noUiPlugins);
                }

                document.body.appendChild(tooltipEl);
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

            const updateBadge = (currentMatchesMap) => {
                const matchedKeys = Object.keys(currentMatchesMap).filter(id =>
                    currentMatchesMap[id].groupIndices.includes(index) // Match by exact group index, not title
                );

                // Info icon restored
                badge.innerText = `${matchedKeys.length} matches ⓘ`;

                if (matchedKeys.length > 0) {
                    const savedOrder = group.items ? group.items.map(i => i.id || i.name) : [];
                    
                    matchedKeys.sort((a, b) => {
                        const nameA = currentMatchesMap[a].manifestName;
                        const nameB = currentMatchesMap[b].manifestName;
                        
                        let indexA = savedOrder.indexOf(a);
                        if (indexA === -1) indexA = savedOrder.indexOf(nameA);
                        
                        let indexB = savedOrder.indexOf(b);
                        if (indexB === -1) indexB = savedOrder.indexOf(nameB);
                        
                        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                        if (indexA !== -1) return -1;
                        if (indexB !== -1) return 1;
                        
                        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                    });
                }

                badge.tooltipDataObject = matchedKeys.map((id) => {
                    const matchData = currentMatchesMap[id];
                    return {
                        id: id,
                        manifestName: matchData.manifestName,
                        uiName: matchData.uiName !== matchData.manifestName ? matchData.uiName : null,
                        otherGroups: matchData.groups.filter((t, i) => matchData.groupIndices[i] !== index), // Exclude the current group by index
                        hasUI: matchData.hasUI // Inherit robust API verification
                    };
                });
            };

            // Store the updater function so we can call it when ANY keyword box changes
            badgeUpdaters.push(updateBadge);

            kwSetting.addTextArea(t => {
                t.inputEl.classList.add('my-org-keywords-input');
                t.setValue(group.keywords).onChange(async v => {
                    this.plugin.settings.groups[index].keywords = v;

                    // 1. Recalculate overlaps globally
                    const newMatchesMap = recalculateAllMatches();

                    // 2. Tell all badges to update themselves in-place
                    badgeUpdaters.forEach(update => update(newMatchesMap));

                    // 3. Save quietly. NO this.display() here!
                    await this.plugin.saveSettings(true);
                });
            });
        });

        // Render the initial states for all badges on page load
        const initialMatchesMap = recalculateAllMatches();
        badgeUpdaters.forEach(update => update(initialMatchesMap));

        const btnDiv = containerEl.createDiv({ cls: 'my-org-add-group-container' });
        const btn = btnDiv.createEl('button', { text: '+ Add group', cls: 'mod-cta my-org-add-group-btn' });

        btn.onclick = async () => {
            this.plugin.settings.groups.push({ title: 'New Folder', keywords: '', items: [] });
            await this.plugin.saveSettings();
            this.display();

            // Automatically set cursor to the title of the newly added group
            const titleInputs = containerEl.querySelectorAll('.my-org-group-card input[type="text"]');
            if (titleInputs.length > 0) {
                const lastInput = titleInputs[titleInputs.length - 1];
                lastInput.focus();
                lastInput.select(); // Selects "New Folder" to overwrite it immediately
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

class PluginNoteModal extends obsidian.Modal {
    constructor(app, pluginData, pluginInstance, onSave) {
        super(app);
        this.pluginData = pluginData; // Object containing {id, name}
        this.pluginInstance = pluginInstance;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Notes: ${this.pluginData.name}` });

        const textArea = contentEl.createEl('textarea', { cls: 'my-org-note-textarea' });
        textArea.placeholder = "Write your thoughts about this plugin here...";
        // Load existing note if present
        textArea.value = this.pluginInstance.settings.pluginNotes[this.pluginData.id] || '';

        const actions = contentEl.createDiv({ cls: 'my-org-modal-actions' });

        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = actions.createEl('button', { text: 'Save note', cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            const note = textArea.value.trim();
            if (note) {
                this.pluginInstance.settings.pluginNotes[this.pluginData.id] = note;
            } else {
                delete this.pluginInstance.settings.pluginNotes[this.pluginData.id]; // Cleanup if empty
            }
            await this.pluginInstance.saveSettings(false); // Save quietly
            this.onSave(); // Trigger UI refresh in the list
            this.close();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}