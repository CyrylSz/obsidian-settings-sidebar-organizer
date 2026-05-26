const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    showUngrouped: true,
    collapsibleHeaders: true,
    compactMode: false,
    startCollapsed: false,
    groups: [],
    collapsedSections: [],
    collapsedGroups: {}
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
            // Catches the global click and waits for Obsidian to finish rebuilding the Document Object Model
            if (evt.target.closest('.checkbox-container') || evt.target.closest('button')) {
                // Clear any existing timers if the user clicks rapidly (prevents overlapping chaos)
                if (this.clickTimer1) clearTimeout(this.clickTimer1);
                if (this.clickTimer2) clearTimeout(this.clickTimer2);
                if (this.clickTimer3) clearTimeout(this.clickTimer3);

                // 1. Catches fast computers almost instantly
                this.clickTimer1 = setTimeout(() => this.checkAndApply(), 100);

                // 2. Catches average computers and moderate vaults
                this.clickTimer2 = setTimeout(() => this.checkAndApply(), 500);

                // 3. Catches very slow computers or incredibly heavy vaults
                this.clickTimer3 = setTimeout(() => this.checkAndApply(), 1500);
            }

            if (!this.settings.collapsibleHeaders) return;
            if (evt.target.closest('.my-org-section-btn')) return;

            if (evt.target.classList.contains('vertical-tab-header-group-title')) {
                const header = evt.target;
                const title = header.innerText.trim();
                const group = header.parentElement;
                const itemsContainer = group.querySelector('.vertical-tab-header-group-items');

                if (itemsContainer) {
                    const isCollapsed = itemsContainer.classList.toggle('is-collapsed');
                    header.classList.toggle('is-collapsed', isCollapsed);

                    if (isCollapsed) {
                        if (!this.settings.collapsedSections.includes(title)) this.settings.collapsedSections.push(title);
                    } else {
                        this.settings.collapsedSections = this.settings.collapsedSections.filter(t => t !== title);
                    }
                    this.saveSettings(false);
                    evt.stopPropagation();
                }
            }
        });
    }

    // Manages sidebar observation logic
    startSidebarWatcher() {
        this.registerInterval(window.setInterval(() => {
            const sidebar = document.querySelector('.vertical-tab-header-group-items');

            if (sidebar) {
                // Sidebar exists (settings are open)
                if (!this.observing) {
                    this.observing = true;
                    // Listen for changes in the element list
                    this.observer.observe(sidebar, { childList: true, subtree: true });
                    // Trigger organization once at start
                    this.checkAndApply();
                }
            } else {
                // Sidebar does not exist (settings are closed)
                if (this.observing) {
                    this.observer.disconnect();
                    this.observing = false;

                    // INSTANT COLLAPSE: Forget opened folders the moment settings are closed
                    if (this.settings.startCollapsed) {
                        this.settings.collapsedGroups = {};
                        // Save silently so it remembers the state for next time
                        this.saveSettings(false);
                    }
                }
            }
        }, 100)); // Changed from 1000ms to 100ms for instant reaction
    }

    onunload() {
        if (this.observer) this.observer.disconnect();

        document.body.classList.remove('my-org-collapse-enabled');

        document.querySelectorAll('.my-org-folder').forEach(f => f.remove());
        document.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));
        document.querySelectorAll('.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));
        document.querySelectorAll('.my-org-hide-nav').forEach(el => el.classList.remove('my-org-hide-nav'));
        document.querySelectorAll('.my-org-section-btn').forEach(btn => btn.remove());
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
            const title = header.innerText.trim();
            if (this.settings.collapsedSections.includes(title)) {
                header.classList.add('is-collapsed');
                const group = header.parentElement;
                const items = group.querySelector('.vertical-tab-header-group-items');
                if (items) items.classList.add('is-collapsed');
            }
        });
    }

    manageCompactMode() {
        const sidebar = document.querySelector('.vertical-tab-content-container');
        const navItems = Array.from(document.querySelectorAll('.vertical-tab-nav-item'));
        const headers = Array.from(document.querySelectorAll('.vertical-tab-header-group-title'));

        const targets = ['Core plugins', 'Community plugins'];
        const targetNavItems = navItems.filter(item => targets.includes(item.innerText.trim()));
        const targetHeaders = headers.filter(h => targets.includes(h.innerText.trim()));

        if (this.settings.compactMode) {
            targetNavItems.forEach(item => {
                item.classList.add('my-org-hide-nav');
            });

            targetHeaders.forEach(header => {
                if (header.querySelector('.my-org-section-btn')) return;

                const btn = document.createElement('div');
                btn.className = 'my-org-section-btn';
                btn.setAttribute('aria-label', `Manage ${header.innerText}`);
                obsidian.setIcon(btn, 'settings');

                btn.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const name = header.innerText.trim();
                    const linkToClick = targetNavItems.find(i => i.innerText.trim() === name);
                    if (linkToClick) linkToClick.click();
                };
                header.appendChild(btn);
            });
        } else {
            targetNavItems.forEach(item => item.classList.remove('my-org-hide-nav'));
            document.querySelectorAll('.my-org-section-btn').forEach(b => b.remove());
        }
    }

    checkAndApply() {
        const sidebar = document.querySelector('.vertical-tab-header-group-items');
        if (!sidebar) return;

        // Restore collapse if needed
        if (this.settings.collapsibleHeaders) {
            const firstCollapsed = this.settings.collapsedSections[0];
            if (firstCollapsed) {
                const header = Array.from(document.querySelectorAll('.vertical-tab-header-group-title'))
                    .find(h => h.innerText.trim() === firstCollapsed);
                if (header && !header.classList.contains('is-collapsed')) {
                    this.restoreSectionStates();
                }
            }
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

        const pluginNames = Object.values(this.app.plugins.manifests).map(m => m.name);
        const allNavItems = Array.from(document.querySelectorAll('.vertical-tab-nav-item'));
        if (allNavItems.length === 0) {
            this.isOrganizing = false;
            return;
        }

        let targetContainer = null;
        for (const item of allNavItems) {
            if (pluginNames.includes(item.innerText.trim()) || pluginNames.some(p => item.innerText.includes(p))) {
                targetContainer = item.parentElement;
                break;
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
            const name = item.innerText.trim();

            // Fix for renaming issues: rely on exact settings ID from the document element
            const settingId = item.getAttribute('data-setting-id');
            const isCommunityPlugin = settingId && this.app.plugins.manifests[settingId];

            if (!isCommunityPlugin) return;
            if (item.classList.contains('my-org-hidden')) return;

            if (!foldersInserted) {
                groupsMap.forEach(g => targetContainer.insertBefore(g.element, item));
                if (this.settings.showUngrouped) targetContainer.insertBefore(ungroupedDetails, item);
                foldersInserted = true;
            }

            let matchedCount = 0;
            for (const group of groupsMap) {
                if (group.keywords.some(k => name.toLowerCase().includes(k))) {
                    const config = group.items.find(i => i.name === name);
                    const displayName = (config && config.alias) ? config.alias : name;

                    const proxy = this.createProxy(displayName, name, item, targetContainer);
                    group.element.appendChild(proxy);
                    group.proxies.push({ name: name, element: proxy });

                    matchedCount++;
                }
            }

            if (matchedCount > 0) {
                item.classList.add('my-org-hidden');
            } else {
                if (this.settings.showUngrouped) {
                    const proxy = this.createProxy(name, name, item, targetContainer);
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
                return 0;
            });
            group.proxies.forEach(p => group.element.appendChild(p.element));
        });

        if (this.settings.showUngrouped) {
            if (ungroupedCount > 0) ungroupedSummary.innerText = `Ungrouped (${ungroupedCount})`;
            else ungroupedDetails.remove();
        }

        // Reset flag after operation completes
        // setTimeout ensures DOM has settled
        setTimeout(() => {
            this.isOrganizing = false;
        }, 0);
    }

    createProxy(displayName, realName, originalItem, container) {
        const proxy = document.createElement('div');
        proxy.className = 'my-org-proxy';
        proxy.innerText = displayName;

        // Check if originalItem is still in DOM and active for initial styling
        if (originalItem && originalItem.classList.contains('is-active')) {
            proxy.classList.add('is-active');
        }

        proxy.onclick = (e) => {
            e.stopPropagation();

            // Immediate visual feedback for responsiveness
            container.querySelectorAll('.my-org-proxy').forEach(p => p.classList.remove('is-active'));
            proxy.classList.add('is-active');

            // Find the current live element in the DOM instead of relying on potentially detached original references
            const freshTarget = Array.from(container.querySelectorAll('.vertical-tab-nav-item'))
                .find(el => el.innerText.trim() === realName && !el.classList.contains('my-org-proxy'));

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
    }

    checkForChanges() {
        const isChanged = JSON.stringify(this.originalItems) !== JSON.stringify(this.items);
        if (this.saveBtn) this.saveBtn.disabled = !isChanged;
    }

    updateSaveState() {
        if (this.saveBtn) {
            this.saveBtn.disabled = !this.hasChanges;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        new obsidian.Setting(contentEl).setName(`Edit items: ${this.group.title}`).setHeading();
        contentEl.createEl('p', { text: 'Click arrows to reorder. Type to rename.', cls: 'my-org-modal-desc' });

        if (!this.app.plugins || !this.app.plugins.manifests) return;
        const allPlugins = Object.values(this.app.plugins.manifests).map(m => m.name);
        const keywords = this.group.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

        const matchingPlugins = allPlugins.filter(name =>
            keywords.some(k => name.toLowerCase().includes(k))
        );

        let currentItems = this.group.items || [];
        currentItems = currentItems.filter(i => matchingPlugins.includes(i.name));
        matchingPlugins.forEach(name => {
            if (!currentItems.find(i => i.name === name)) {
                currentItems.push({ name: name, alias: '' });
            }
        });

        // Deep copy to prevent passing by reference
        this.originalItems = JSON.parse(JSON.stringify(currentItems));
        this.items = JSON.parse(JSON.stringify(currentItems));

        // Replace paragraph with flex header containing the sort combobox
        contentEl.querySelector('.my-org-modal-desc').remove();
        const headerRow = contentEl.createDiv({ cls: 'my-org-modal-header-row' });
        headerRow.createEl('p', { text: 'Click arrows to reorder. Type to rename.', cls: 'my-org-modal-desc' });

        const sortSelect = headerRow.createEl('select', { cls: 'dropdown my-org-sort-select' });
        sortSelect.add(new Option('Sort by...', 'none'));
        sortSelect.add(new Option('Alias A-Z', 'az'));
        sortSelect.add(new Option('Alias Z-A', 'za'));
        sortSelect.onchange = () => {
            if (sortSelect.value === 'az') {
                this.items.sort((a, b) => (a.alias || a.name).localeCompare(b.alias || b.name));
            } else if (sortSelect.value === 'za') {
                this.items.sort((a, b) => (b.alias || b.name).localeCompare(a.alias || a.name));
            }
            sortSelect.value = 'none'; // Revert to placeholder after sorting
            this.checkForChanges();
            this.renderList();
        };

        this.listContainer = contentEl.createDiv({ cls: 'my-org-modal-list' });
        this.renderList();

        const btnDiv = contentEl.createDiv({ cls: 'my-org-modal-actions' });
        const resetBtn = btnDiv.createEl('button', { text: 'Reset defaults', cls: 'my-org-btn-reset' });

        resetBtn.onclick = () => {
            this.items.sort((a, b) => a.name.localeCompare(b.name));
            this.items.forEach(i => i.alias = '');
            this.checkForChanges();
            this.renderList();
        };

        this.saveBtn = btnDiv.createEl('button', { text: 'Save changes', cls: 'mod-cta' });
        this.saveBtn.disabled = true;
        this.saveBtn.onclick = async () => {
            this.plugin.settings.groups[this.groupIndex].items = this.items;
            await this.plugin.saveSettings(true);
            this.close();
        };
    }

    renderList() {
        this.listContainer.empty();
        if (this.items.length === 0) {
            this.listContainer.createDiv({ text: 'No plugins found matching keywords.', cls: 'my-org-modal-empty' });
            return;
        }

        this.items.forEach((item, index) => {
            const row = this.listContainer.createDiv({ cls: 'my-org-modal-item' });
            const ctrls = row.createDiv({ cls: 'my-org-modal-controls' });

            const upBtn = ctrls.createEl('div', { cls: 'my-org-modal-btn', text: '▲' });
            upBtn.onclick = () => {
                if (index > 0) {
                    [this.items[index - 1], this.items[index]] = [this.items[index], this.items[index - 1]];
                    this.checkForChanges();
                    this.renderList();
                }
            };
            if (index === 0) upBtn.classList.add('is-disabled');

            const downBtn = ctrls.createEl('div', { cls: 'my-org-modal-btn', text: '▼' });
            downBtn.onclick = () => {
                if (index < this.items.length - 1) {
                    [this.items[index + 1], this.items[index]] = [this.items[index], this.items[index + 1]];
                    this.checkForChanges();
                    this.renderList();
                }
            };
            if (index === this.items.length - 1) downBtn.classList.add('is-disabled');

            row.createDiv({ cls: 'my-org-modal-item-name', text: item.name, title: item.name });
            row.createDiv({ cls: 'my-org-modal-arrow', text: '→' });

            const input = row.createEl('input', { type: 'text', placeholder: 'Alias...' });
            input.value = item.alias || '';
            // Change from onchange to oninput to catch live typing
            input.oninput = (e) => {
                this.items[index].alias = e.target.value;
                this.checkForChanges();
            };
        });
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
            .setName('Collapsible sidebar headers')
            .setDesc('Allow collapsing "Options", "Core plugins", and "Community plugins".')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.collapsibleHeaders)
                .onChange(async (value) => {
                    this.plugin.settings.collapsibleHeaders = value;
                    await this.plugin.saveSettings();
                    if (!value) {
                        document.querySelectorAll('.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));
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
            .setDesc('Start with all groups collapsed when opening the settings menu.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.startCollapsed)
                .onChange(async (value) => {
                    this.plugin.settings.startCollapsed = value;
                    await this.plugin.saveSettings(true);
                }));

        containerEl.createEl('hr');
        new obsidian.Setting(containerEl).setName('Your groups').setHeading();

        const allPlugins = this.app.plugins && this.app.plugins.manifests
            ? Object.values(this.app.plugins.manifests).map(m => m.name) : [];

        // Helper function to calculate overlaps across all groups
        const recalculateAllMatches = () => {
            const pluginMatches = {};
            allPlugins.forEach(p => pluginMatches[p] = []);

            this.plugin.settings.groups.forEach(g => {
                const kws = g.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
                if (kws.length > 0) {
                    allPlugins.forEach(p => {
                        if (kws.some(k => p.toLowerCase().includes(k))) {
                            pluginMatches[p].push(g.title);
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
                    .setTooltip('Manage items (rename & reorder)')
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
            });

            headerSetting.addExtraButton(b => b.setIcon('trash').setTooltip('Delete group').onClick(async () => {
                this.plugin.settings.groups.splice(index, 1);
                delete this.plugin.settings.collapsedGroups[group.title];
                await this.plugin.saveSettings();
                this.display();
            }));

            new obsidian.Setting(div).setName('Title').addText(t => t.setValue(group.title).onChange(async v => {
                const oldState = this.plugin.settings.collapsedGroups[this.plugin.settings.groups[index].title];
                delete this.plugin.settings.collapsedGroups[this.plugin.settings.groups[index].title];
                if (oldState !== undefined) this.plugin.settings.collapsedGroups[v] = oldState;

                this.plugin.settings.groups[index].title = v;
                await this.plugin.saveSettings();
            }));

            const kwSetting = new obsidian.Setting(div).setName('Keywords');

            // Create Badge
            const badge = kwSetting.nameEl.createSpan({ cls: 'my-org-match-badge' });

            // Logic to update a single badge's text and tooltip WITHOUT rebuilding the page
            const updateBadge = (currentMatchesMap) => {
                const matchedForThis = Object.keys(currentMatchesMap).filter(p => currentMatchesMap[p].includes(group.title));
                badge.innerText = `${matchedForThis.length} matches ⓘ`;

                if (matchedForThis.length > 0) {
                    let tooltipText = '';
                    matchedForThis.forEach(p => {
                        const isOverlap = currentMatchesMap[p].length > 1;
                        tooltipText += `• ${p}`;
                        if (isOverlap) {
                            const otherGroups = currentMatchesMap[p].filter(t => t !== group.title);
                            tooltipText += ` (also in: ${otherGroups.join(', ')})`;
                        }
                        tooltipText += '\n';
                    });
                    badge.setAttribute('aria-label', tooltipText.trim());
                    badge.setAttribute('data-tooltip-position', 'top');
                } else {
                    badge.setAttribute('aria-label', 'No plugins match these keywords.');
                    badge.setAttribute('data-tooltip-position', 'top');
                }
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
        };
    }
}